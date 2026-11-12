/**
 * Maya / THORChain DASH deposits sent from the user's Dash Core wallet.
 *
 * Every input comes from one address the user picks, and the change goes
 * back to it: Maya and THORChain take the sender — where a refund goes — from
 * the first input. The transaction is built here with explicit inputs and
 * outputs (vault, OP_RETURN memo, change), decoded by the node and checked
 * output by output before it is shown; after signing it is decoded and
 * checked again, test-accepted by the mempool and only then broadcast.
 * The calls go through the Rust side (dash_core.rs), which allows only the
 * methods used here.
 */
import { ThorLikeDeposit } from '../providers/thorlike';
import { tr } from '../i18n';

const invoke = (cmd: string, args: Record<string, unknown>): Promise<any> => {
  const tauri = (window as any).__TAURI__;
  if (!tauri?.core?.invoke) return Promise.reject(new Error(tr('Dash Core needs the desktop app')));
  return tauri.core.invoke(cmd, args);
};

const rpc = (method: string, params: unknown[], wallet?: string): Promise<any> =>
  invoke('dash_core_rpc', { method, params, wallet: wallet ?? null }).catch((err) => {
    throw new Error(typeof err === 'string' ? err : err?.message ?? String(err));
  });

/** The shell's Exchange → Connect wallet → Dash Core state. */
export interface DashCoreStatus {
  connected: boolean;
  dir: string;
}

export const dashCoreStatus = (): DashCoreStatus =>
  (window as any).AppDashCore?.getStatus?.() ?? { connected: false, dir: '' };

export const openDashCoreSettings = () => (window as any).AppDashCore?.open?.();

/** Re-checks the node (running, synchronised, wallets open) before using it. */
export async function refreshDashCore(): Promise<{ status: DashCoreStatus; report: any }> {
  const app = (window as any).AppDashCore;
  if (!app?.refresh) return { status: dashCoreStatus(), report: null };
  const state = await app.refresh();
  return { status: { connected: !!state.connected, dir: state.dir ?? '' }, report: state.report };
}

/** Masternode and evonode collateral: never spent by a deposit even when not locked. */
const COLLATERAL = [1000n * 100_000_000n, 4000n * 100_000_000n];
/** Change below this goes to the fee instead (Dash's dust limit is 546 duffs). */
const DUST = 1000n;
const MAX_INPUTS = 200;

export interface Utxo {
  txid: string;
  vout: number;
  duffs: bigint;
}

/** One address of a wallet with its spendable coins. */
export interface DashSource {
  wallet: string;
  encrypted: boolean;
  address: string;
  label: string;
  total: bigint;
  utxos: Utxo[];
  /** Collateral-sized coins left out. */
  skipped: number;
}

/** Coins as duffs; RPC amounts are DASH with 8 decimals. */
export const toDuffs = (value: unknown): bigint => {
  const text = typeof value === 'number' ? value.toFixed(8) : String(value ?? '0');
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole || '0') * 100_000_000n + BigInt((frac + '00000000').slice(0, 8));
};

export const fromDuffs = (duffs: bigint): string => {
  const whole = duffs / 100_000_000n;
  const frac = (duffs % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
};

/**
 * Addresses of the open wallets that can pay: confirmed, spendable coins of
 * ordinary P2PKH addresses (X…). A P2SH address could be a multisig, which
 * the networks do not credit a refund to.
 */
export async function loadSources(report: any): Promise<DashSource[]> {
  const wallets: any[] = (report?.wallets ?? []).filter((w: any) => w.privateKeysEnabled !== false);
  const out: DashSource[] = [];
  for (const w of wallets) {
    const unspent: any[] = await rpc('listunspent', [1, 9999999], w.name);
    const byAddress = new Map<string, DashSource>();
    for (const u of unspent) {
      if (!u.spendable || !u.solvable || typeof u.address !== 'string' || !/^X[1-9A-HJ-NP-Za-km-z]{33}$/.test(u.address)) continue;
      const duffs = toDuffs(u.amount);
      let src = byAddress.get(u.address);
      if (!src) {
        src = { wallet: w.name, encrypted: !!w.encrypted, address: u.address, label: u.label ?? '', total: 0n, utxos: [], skipped: 0 };
        byAddress.set(u.address, src);
      }
      if (COLLATERAL.includes(duffs)) {
        src.skipped++;
        continue;
      }
      src.total += duffs;
      src.utxos.push({ txid: u.txid, vout: u.vout, duffs });
    }
    out.push(...[...byAddress.values()].filter((s) => s.utxos.length));
  }
  return out.sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

/** OP_RETURN script for the memo: 6a, the push, the bytes. */
export function memoScript(memoHex: string): string {
  const len = memoHex.length / 2;
  if (len > 80) throw new Error(tr('The memo is longer than 80 bytes'));
  const push = len <= 75 ? len.toString(16).padStart(2, '0') : `4c${len.toString(16).padStart(2, '0')}`;
  return `6a${push}${memoHex}`.toLowerCase();
}

/** Size of a P2PKH transaction with these inputs, the vault, the memo and a change output (upper bound). */
const estimateSize = (inputs: number, memoBytes: number, change: boolean) =>
  10 + inputs * 148 + 34 + (8 + 1 + 2 + memoBytes) + (change ? 34 : 0);

export interface DashDraft {
  source: DashSource;
  inputs: Utxo[];
  amount: bigint;
  fee: bigint;
  change: bigint;
  feeRate: number;
  hex: string;
  vault: string;
  memoHex: string;
}

/** Chooses the coins (largest first) for amount + fee at the rate. */
function select(source: DashSource, amount: bigint, memoBytes: number, rate: number, minSize = 0) {
  const coins = [...source.utxos].sort((a, b) => (b.duffs > a.duffs ? 1 : b.duffs < a.duffs ? -1 : 0));
  const inputs: Utxo[] = [];
  let sum = 0n;
  for (const coin of coins) {
    inputs.push(coin);
    sum += coin.duffs;
    if (inputs.length > MAX_INPUTS) break;
    const fee = BigInt(Math.ceil(Math.max(estimateSize(inputs.length, memoBytes, true), minSize) * rate));
    if (sum >= amount + fee) {
      let change = sum - amount - fee;
      let total = fee;
      if (change < DUST) {
        total += change;
        change = 0n;
      }
      return { inputs, fee: total, change };
    }
  }
  return null;
}

/** Checks a decoded transaction pays exactly vault, memo and change — nothing else. */
function verify(decoded: any, draft: Omit<DashDraft, 'hex'>) {
  const ins: any[] = decoded?.vin ?? [];
  const outs: any[] = decoded?.vout ?? [];
  const want = new Set(draft.inputs.map((u) => `${u.txid}:${u.vout}`));
  if (ins.length !== draft.inputs.length || !ins.every((i) => want.has(`${i.txid}:${i.vout}`))) {
    throw new Error(tr('Dash Core built other inputs than chosen'));
  }
  const addr = (o: any): string | undefined => o?.scriptPubKey?.address ?? o?.scriptPubKey?.addresses?.[0];
  // Dash Core also gives the exact duffs (valueSat).
  const duffs = (o: any): bigint => (o?.valueSat != null ? BigInt(o.valueSat) : toDuffs(o?.value));
  const expected = 2 + (draft.change > 0n ? 1 : 0);
  if (outs.length !== expected) throw new Error(tr('The transaction has unexpected outputs'));
  const vault = outs.filter((o) => addr(o) === draft.vault);
  if (vault.length !== 1 || duffs(vault[0]) !== draft.amount) {
    throw new Error(tr('The vault output does not pay the quoted amount'));
  }
  const memo = outs.filter((o) => o?.scriptPubKey?.type === 'nulldata');
  if (memo.length !== 1 || String(memo[0].scriptPubKey.hex).toLowerCase() !== memoScript(draft.memoHex) || duffs(memo[0]) !== 0n) {
    throw new Error(tr('The OP_RETURN output does not carry the memo'));
  }
  if (draft.change > 0n) {
    const change = outs.filter((o) => addr(o) === draft.source.address);
    if (change.length !== 1 || duffs(change[0]) !== draft.change) {
      throw new Error(tr('The change does not go back to the sending address'));
    }
  }
}

async function create(source: DashSource, deposit: ThorLikeDeposit, picked: ReturnType<typeof select>) {
  if (!picked) throw new Error(tr('Not enough DASH at this address for the amount and the fee'));
  const outputs: Record<string, string>[] = [{ [deposit.vault]: fromDuffs(deposit.amount) }, { data: deposit.memoHex }];
  if (picked.change > 0n) outputs.push({ [source.address]: fromDuffs(picked.change) });
  const inputs = picked.inputs.map((u) => ({ txid: u.txid, vout: u.vout }));
  try {
    return String(await rpc('createrawtransaction', [inputs, outputs]));
  } catch (err: any) {
    // Older nodes take one outputs object only; the order is then theirs and is checked by verify().
    if (!/expected type object/i.test(err?.message ?? '')) throw err;
    return String(await rpc('createrawtransaction', [inputs, Object.assign({}, ...outputs)]));
  }
}

/**
 * The unsigned deposit from one address: vault output, memo, change back to
 * the same address. Fee at the vault's rate (sats per byte), at least 1.
 */
export async function draftDeposit(source: DashSource, deposit: ThorLikeDeposit): Promise<DashDraft> {
  const rate = Math.max(deposit.gasRate || 0, 1);
  const memoBytes = deposit.memoHex.length / 2;
  memoScript(deposit.memoHex);
  const picked = select(source, deposit.amount, memoBytes, rate);
  const hex = await create(source, deposit, picked);
  const draft = { source, inputs: picked!.inputs, amount: deposit.amount, fee: picked!.fee, change: picked!.change, feeRate: rate, vault: deposit.vault, memoHex: deposit.memoHex };
  verify(await rpc('decoderawtransaction', [hex]), draft);
  return { ...draft, hex };
}

/**
 * Unlocks the wallet for a minute when it is encrypted, signs, checks the
 * signed transaction again, test-accepts it and broadcasts it. A signed
 * transaction bigger than estimated is rebuilt once with the real size.
 * Returns the txid.
 */
export async function signAndSend(draft: DashDraft, deposit: ThorLikeDeposit, passphrase: string): Promise<string> {
  const wallet = draft.source.wallet;
  let unlocked = false;
  if (draft.source.encrypted) {
    const info = await rpc('getwalletinfo', [], wallet);
    if (!(Number(info?.unlocked_until) > Date.now() / 1000 + 30)) {
      if (!passphrase) throw new Error(tr('Enter the wallet password'));
      await rpc('walletpassphrase', [passphrase, 60], wallet);
      unlocked = true;
    }
  }
  try {
    let current = draft;
    for (let attempt = 0; ; attempt++) {
      const signed = await rpc('signrawtransactionwithwallet', [current.hex], wallet);
      if (!signed?.complete) {
        throw new Error(tr('Dash Core could not sign every input: {error}', { error: signed?.errors?.[0]?.error ?? '?' }));
      }
      const size = signed.hex.length / 2;
      if (BigInt(Math.ceil(size * current.feeRate)) > current.fee && attempt === 0) {
        const picked = select(current.source, current.amount, current.memoHex.length / 2, current.feeRate, size + 2);
        const hex = await create(current.source, deposit, picked);
        const next = { ...current, inputs: picked!.inputs, fee: picked!.fee, change: picked!.change };
        verify(await rpc('decoderawtransaction', [hex]), next);
        current = { ...next, hex };
        continue;
      }
      verify(await rpc('decoderawtransaction', [signed.hex]), current);
      const accept = await rpc('testmempoolaccept', [[signed.hex]]);
      if (accept?.[0] && accept[0].allowed === false) {
        throw new Error(tr('The network would reject it: {error}', { error: accept[0]['reject-reason'] ?? '?' }));
      }
      return String(await rpc('sendrawtransaction', [signed.hex]));
    }
  } finally {
    if (unlocked) await rpc('walletlock', [], wallet).catch(() => undefined);
  }
}

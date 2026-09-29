import { sha256 } from 'viem';
import { fetchTokens } from '../bestrate/catalog';
import { BrToken } from '../bestrate/types';
import { diag } from '../../diag';
import { tronAdapter } from '../../wallet/tron';
import { TRON_CHAIN_ID } from './chains';
import { hexToBytes, hexToTron, tronToHex } from './codec';
import { assessRisk, UNLIMITED, valueAtRisk } from './risk';
import { eachLimited } from './spenders';
import { Approval, SpenderInfo } from './types';

/**
 * TRC-20 approvals. TronGrid (free, no key) lists the transactions the
 * wallet sent; the `approve` calls among them give the pairs, and a read of
 * `allowance` says which are still open. Revokes are built by TronGrid,
 * checked here, signed by the wallet over WalletConnect and broadcast.
 */

const TRONGRID = 'https://api.trongrid.io';
const APPROVE = '095ea7b3';
const INCREASE_ALLOWANCE = '39509351';
/** 200 transactions a page; older history beyond this is not read. */
const MAX_PAGES = 25;
/** A revoke may burn at most this much TRX for energy (sun). */
const FEE_LIMIT = 50_000_000;
/** Bandwidth of a revoke transaction when the free daily quota is used up (sun). */
const BANDWIDTH_SUN = 400_000;

async function tronFetch(path: string, signal: AbortSignal, body?: object): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${TRONGRID}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    // The free tier throttles bursts; a short pause is enough.
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`TronGrid answered ${res.status}`);
    return res.json();
  }
}

const word = (hex: string) => hex.padStart(64, '0');
const addressWord = (tron: string) => word(tronToHex(tron).slice(2));

async function constantCall(owner: string, contract: string, selector: string, parameter: string, signal: AbortSignal) {
  const body = await tronFetch('/wallet/triggerconstantcontract', signal, {
    owner_address: owner,
    contract_address: contract,
    function_selector: selector,
    parameter,
    visible: true,
  });
  if (!body?.result?.result) throw new Error(`${selector} on ${contract} failed`);
  return { hex: String(body.constant_result?.[0] ?? ''), energy: Number(body.energy_used ?? 0) };
}

const readUint = (hex: string) => (hex ? BigInt(`0x${hex.slice(0, 64) || '0'}`) : 0n);

function readString(hex: string): string | undefined {
  try {
    const bytes = hexToBytes(hex);
    const len = Number(readUint(hex.slice(64, 128)));
    const text = new TextDecoder().decode(bytes.slice(64, 64 + len));
    return text.replace(/\0/g, '').trim() || undefined;
  } catch {
    return undefined;
  }
}

interface Pair {
  token: string;
  spender: string;
  time: number;
  tx: string;
}

/** Every token/spender pair from the wallet's own approve transactions, newest first. */
async function findPairs(owner: string, signal: AbortSignal): Promise<{ pairs: Pair[]; truncated: boolean }> {
  const latest = new Map<string, Pair>();
  let fingerprint = '';
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ only_from: 'true', limit: '200', search_internal: 'false' });
    if (fingerprint) query.set('fingerprint', fingerprint);
    const body = await tronFetch(`/v1/accounts/${owner}/transactions?${query}`, signal);
    for (const tx of body?.data ?? []) {
      const contract = tx?.raw_data?.contract?.[0];
      if (contract?.type !== 'TriggerSmartContract') continue;
      const value = contract.parameter?.value ?? {};
      const data = String(value.data ?? '').toLowerCase();
      if (!data.startsWith(APPROVE) && !data.startsWith(INCREASE_ALLOWANCE)) continue;
      try {
        const token = hexToTron(String(value.contract_address));
        const spender = hexToTron(data.slice(32, 72));
        const key = `${token}:${spender}`;
        if (!latest.has(key)) latest.set(key, { token, spender, time: Math.floor(Number(tx.block_timestamp ?? 0) / 1000), tx: tx.txID });
      } catch {
        // Malformed call data: not an approval we can read.
      }
    }
    fingerprint = body?.meta?.fingerprint ?? '';
    if (!fingerprint) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { pairs: [...latest.values()], truncated };
}

async function spenderInfo(spender: string, signal: AbortSignal): Promise<SpenderInfo> {
  const body = await tronFetch('/wallet/getcontract', signal, { value: spender, visible: true }).catch(() => null);
  if (!body || !body.bytecode) return { type: body ? 'account' : 'unknown' };
  return { type: 'contract', name: body.name || undefined, verified: null };
}

export interface TronScanResult {
  approvals: Approval[];
  note?: string;
}

export async function scanTron(owner: string, signal: AbortSignal): Promise<TronScanResult> {
  const { pairs, truncated } = await findPairs(owner, signal);
  const listed = await fetchTokens(TRON_CHAIN_ID).catch(() => [] as BrToken[]);
  const byAddress = new Map(listed.map((t) => [t.address, t]));
  const approvals: Approval[] = [];
  const spenders = new Map<string, Promise<SpenderInfo>>();
  const metas = new Map<string, Promise<{ symbol?: string; decimals?: number; balance?: bigint }>>();

  const meta = (token: string) => {
    let hit = metas.get(token);
    if (!hit) {
      hit = (async () => {
        const lifi = byAddress.get(token);
        const balance = await constantCall(owner, token, 'balanceOf(address)', addressWord(owner), signal)
          .then((r) => readUint(r.hex))
          .catch(() => undefined);
        if (lifi) return { symbol: lifi.symbol, decimals: lifi.decimals, balance };
        const [symbol, decimals] = await Promise.all([
          constantCall(owner, token, 'symbol()', '', signal).then((r) => readString(r.hex)).catch(() => undefined),
          constantCall(owner, token, 'decimals()', '', signal).then((r) => Number(readUint(r.hex))).catch(() => undefined),
        ]);
        return { symbol, decimals, balance };
      })();
      metas.set(token, hit);
    }
    return hit;
  };

  await eachLimited(pairs, 3, async (pair) => {
    if (signal.aborted) return;
    const amount = await constantCall(owner, pair.token, 'allowance(address,address)', addressWord(owner) + addressWord(pair.spender), signal)
      .then((r) => readUint(r.hex))
      .catch(() => 0n);
    if (amount === 0n) return;
    if (!spenders.has(pair.spender)) spenders.set(pair.spender, spenderInfo(pair.spender, signal));
    const [info, m] = await Promise.all([spenders.get(pair.spender)!, meta(pair.token)]);
    const lifi = byAddress.get(pair.token);
    const draft = {
      id: `TVM:${pair.token}:${pair.spender}`,
      family: 'TVM' as const,
      chainId: TRON_CHAIN_ID,
      chainName: 'Tron',
      kind: 'token' as const,
      token: pair.token,
      symbol: m.symbol ?? `${pair.token.slice(0, 6)}…`,
      tokenName: lifi?.name,
      decimals: m.decimals,
      logo: lifi?.logo,
      listed: !!lifi && lifi.status === 'verified',
      spender: pair.spender,
      spenderInfo: info,
      amount,
      unlimited: amount >= UNLIMITED,
      balance: m.balance,
      priceUSD: lifi?.priceUSD || undefined,
      lastChange: pair.time || undefined,
      lastTx: pair.tx,
      atRiskUSD: undefined as number | undefined,
    };
    draft.atRiskUSD = valueAtRisk(draft);
    approvals.push({ ...draft, ...assessRisk(draft) });
  });
  return {
    approvals,
    note: truncated ? `Only the last ${MAX_PAGES * 200} transactions were read.` : undefined,
  };
}

// ─── Revoking ───────────────────────────────────────────────────────────────

function refuse(reason: string): never {
  diag('error', 'APPROVALS', `blocked: ${reason}`);
  throw new Error(`Blocked by CoinMan safety check: ${reason}`);
}

/**
 * The transaction TronGrid built must be exactly `approve(spender, 0)` on the
 * token, from the owner, carrying no TRX — in the readable fields and in the
 * bytes the wallet signs.
 */
export function checkTronRevoke(tx: any, owner: string, token: string, spender: string): void {
  const contracts = tx?.raw_data?.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1) refuse('unexpected Tron transaction');
  const [contract] = contracts;
  if (contract?.type !== 'TriggerSmartContract') refuse(`Tron ${contract?.type ?? 'unknown'} transaction`);
  const value = contract.parameter?.value ?? {};
  const same = (a: unknown, b: string) =>
    typeof a === 'string' && (a === b || a.toLowerCase().replace(/^0x/, '') === tronToHex(b));
  if (!same(value.owner_address, owner)) refuse('the revoke is not sent from your address');
  if (!same(value.contract_address, token)) refuse('the revoke goes to another contract');
  if (value.call_value && Number(value.call_value) !== 0) refuse('a revoke never sends TRX');
  if (value.token_id || value.call_token_value) refuse('a revoke never sends tokens');
  const data = `${APPROVE}${addressWord(spender)}${word('0')}`;
  if (String(value.data ?? '').toLowerCase() !== data) refuse('the call is not approve(spender, 0)');
  const raw = String(tx.raw_data_hex ?? '').toLowerCase();
  if (!raw.includes(data) || !raw.includes(tronToHex(owner)) || !raw.includes(tronToHex(token))) {
    refuse('the signed bytes do not match the transaction');
  }
  if (String(tx.txID ?? '').toLowerCase() !== sha256(`0x${raw}`).slice(2)) refuse('transaction id does not match');
}

export interface TronRevokePlan {
  approval: Approval;
  tx?: any;
  /** Estimated TRX burned, in sun. */
  cost?: bigint;
  error?: string;
}

export async function prepareTronRevokes(owner: string, approvals: Approval[], signal: AbortSignal) {
  const params = await tronFetch('/wallet/getchainparameters', signal).catch(() => null);
  const energyFee = BigInt(
    (params?.chainParameter ?? []).find((p: any) => p.key === 'getEnergyFee')?.value ?? 100
  );
  const account = await tronFetch('/wallet/getaccount', signal, { address: owner, visible: true }).catch(() => null);
  const balance = BigInt(account?.balance ?? 0);
  const plans: TronRevokePlan[] = [];
  for (const approval of approvals) {
    const parameter = `${addressWord(approval.spender)}${word('0')}`;
    try {
      const dry = await constantCall(owner, approval.token, 'approve(address,uint256)', parameter, signal);
      const built = await tronFetch('/wallet/triggersmartcontract', signal, {
        owner_address: owner,
        contract_address: approval.token,
        function_selector: 'approve(address,uint256)',
        parameter,
        fee_limit: FEE_LIMIT,
        call_value: 0,
        visible: true,
      });
      if (!built?.result?.result || !built.transaction) throw new Error(built?.result?.message ?? 'TronGrid built nothing');
      checkTronRevoke(built.transaction, owner, approval.token, approval.spender);
      plans.push({ approval, tx: built.transaction, cost: BigInt(dry.energy) * energyFee + BigInt(BANDWIDTH_SUN) });
    } catch (err: any) {
      plans.push({ approval, error: err?.message ?? String(err) });
    }
  }
  const total = plans.reduce((sum, p) => sum + (p.cost ?? 0n), 0n);
  return { plans, balance, total, blocker: total > balance ? 'Not enough TRX for energy and bandwidth' : undefined };
}

/** Signs one prepared revoke in the wallet, broadcasts it and waits for the result. */
export async function sendTronRevoke(owner: string, plan: TronRevokePlan, signal: AbortSignal): Promise<{ ok: boolean; txid: string; detail?: string }> {
  if (!tronAdapter.connected || tronAdapter.address !== owner) throw new Error('Connect the Tron wallet with this address first.');
  const { approval, tx } = plan;
  checkTronRevoke(tx, owner, approval.token, approval.spender);
  const result: any = await tronAdapter.signTransaction(tx);
  // Only the signature is taken from the wallet; the bytes broadcast are the ones checked above.
  if ((result?.raw_data_hex && result.raw_data_hex !== tx.raw_data_hex) || (result?.txID && result.txID !== tx.txID)) {
    refuse('the wallet returned a different transaction');
  }
  if (!Array.isArray(result?.signature) || !result.signature.length) throw new Error('The wallet returned no signature.');
  const sent = await tronFetch('/wallet/broadcasttransaction', signal, { ...tx, signature: result.signature });
  if (!sent?.result) throw new Error(`Broadcast refused: ${sent?.code ?? ''} ${sent?.message ?? ''}`.trim());
  const txid = String(sent.txid ?? tx.txID);
  diag('info', 'APPROVALS', `Tron revoke ${approval.symbol} sent ${txid}`);
  for (let i = 0; i < 40 && !signal.aborted; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const info = await tronFetch('/wallet/gettransactioninfobyid', signal, { value: txid }).catch(() => null);
    if (info?.id) {
      const ok = info.receipt?.result === 'SUCCESS';
      return { ok, txid, detail: ok ? undefined : `result ${info.receipt?.result ?? info.result ?? 'unknown'}` };
    }
  }
  return { ok: false, txid, detail: 'not confirmed yet — check the explorer' };
}

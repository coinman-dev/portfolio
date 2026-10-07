import { ed25519 } from '@noble/curves/ed25519';
import { fetchTokens } from '../bestrate/catalog';
import { BrToken } from '../bestrate/types';
import { diag } from '../../diag';
import { signSolanaTransaction } from '../../wallet/solana';
import { SOLANA_CHAIN_ID } from './chains';
import { base58Decode, base58Encode, base64ToBytes, bytesToBase64 } from './codec';
import { assessRisk, UNLIMITED, valueAtRisk } from './risk';
import { Approval, SpenderInfo } from './types';

/**
 * Solana's version of an approval is a token account's delegate: it may move
 * up to the delegated amount without asking. The owner's token accounts say
 * which have one; a transaction of Revoke instructions clears them. The
 * transaction is built here byte by byte, so it can hold nothing else.
 */

const RPC = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
/** Instruction number of Revoke in both token programs. */
const REVOKE = 5;
/** Revokes per transaction, well inside the 1232-byte limit. */
const PER_TX = 12;
/** Base fee per signature, in lamports. */
const FEE_LAMPORTS = 5000n;

async function rpc<T = any>(method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal,
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Solana RPC answered ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`Solana RPC: ${body.error.message ?? body.error.code}`);
    return body.result as T;
  }
}

/** Ordinary keys lie on the ed25519 curve; program-derived addresses do not. */
function isOnCurve(address: string): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(base58Decode(address));
    return true;
  } catch {
    return false;
  }
}

async function describeDelegates(delegates: string[], signal: AbortSignal): Promise<Map<string, SpenderInfo>> {
  const out = new Map<string, SpenderInfo>();
  for (let i = 0; i < delegates.length; i += 100) {
    const part = delegates.slice(i, i + 100);
    const result = await rpc<{ value: any[] }>(
      'getMultipleAccounts',
      [part, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }],
      signal
    ).catch(() => ({ value: [] as any[] }));
    part.forEach((address, j) => {
      const account = result.value?.[j];
      if (account?.executable) out.set(address, { type: 'contract', name: 'Program', verified: null });
      else if (!isOnCurve(address)) {
        out.set(address, {
          type: 'contract',
          name: account?.owner && account.owner !== SYSTEM_PROGRAM ? `Program account (${account.owner.slice(0, 4)}…)` : 'Program account',
          verified: null,
        });
      } else out.set(address, { type: 'account' });
    });
  }
  return out;
}

export async function scanSolana(owner: string, signal: AbortSignal): Promise<Approval[]> {
  const lists = await Promise.all(
    TOKEN_PROGRAMS.map((programId) =>
      rpc<{ value: any[] }>('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed' }], signal).then((r) =>
        (r.value ?? []).map((item) => ({ ...item, programId }))
      )
    )
  );
  const delegated = lists.flat().filter((item) => {
    const info = item.account?.data?.parsed?.info;
    return info?.delegate && BigInt(info.delegatedAmount?.amount ?? '0') > 0n;
  });
  if (!delegated.length) return [];
  const [infos, listed] = await Promise.all([
    describeDelegates([...new Set(delegated.map((d) => d.account.data.parsed.info.delegate as string))], signal),
    fetchTokens(SOLANA_CHAIN_ID).catch(() => [] as BrToken[]),
  ]);
  const byMint = new Map(listed.map((t) => [t.address, t]));
  return delegated.map((item) => {
    const info = item.account.data.parsed.info;
    const lifi = byMint.get(info.mint);
    const amount = BigInt(info.delegatedAmount.amount);
    const draft = {
      id: `SVM:${item.pubkey}:${info.delegate}`,
      family: 'SVM' as const,
      chainId: SOLANA_CHAIN_ID,
      chainName: 'Solana',
      kind: 'delegate' as const,
      token: info.mint as string,
      tokenAccount: item.pubkey as string,
      tokenProgram: item.programId as string,
      symbol: lifi?.symbol ?? `${String(info.mint).slice(0, 4)}…`,
      tokenName: lifi?.name,
      decimals: Number(info.tokenAmount?.decimals ?? lifi?.decimals ?? 0),
      logo: lifi?.logo,
      listed: !!lifi && lifi.status === 'verified',
      spender: info.delegate as string,
      spenderInfo: infos.get(info.delegate) ?? ({ type: 'unknown' } as SpenderInfo),
      amount,
      unlimited: amount >= UNLIMITED,
      balance: BigInt(info.tokenAmount?.amount ?? '0'),
      priceUSD: lifi?.priceUSD || undefined,
      atRiskUSD: undefined as number | undefined,
    };
    draft.atRiskUSD = valueAtRisk(draft);
    return { ...draft, ...assessRisk(draft) };
  });
}

// ─── Transactions ───────────────────────────────────────────────────────────

function shortVec(n: number): number[] {
  const out: number[] = [];
  let rest = n;
  for (;;) {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest) byte |= 0x80;
    out.push(byte);
    if (!rest) return out;
  }
}

function readShortVec(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let shift = 0, i = at; i < bytes.length; i++, shift += 7) {
    value |= (bytes[i] & 0x7f) << shift;
    if (!(bytes[i] & 0x80)) return [value, i + 1];
  }
  throw new Error('bad length');
}

export interface RevokeTarget {
  tokenAccount: string;
  tokenProgram: string;
}

/** A legacy message: the owner pays and signs, every instruction a Revoke. */
export function buildRevokeMessage(owner: string, targets: RevokeTarget[], blockhash: string): Uint8Array {
  const accounts = [...new Set(targets.map((t) => t.tokenAccount))];
  const programs = [...new Set(targets.map((t) => t.tokenProgram))];
  const keys = [owner, ...accounts, ...programs];
  const index = (key: string) => keys.indexOf(key);
  const bytes: number[] = [1, 0, programs.length, ...shortVec(keys.length)];
  for (const key of keys) {
    const raw = base58Decode(key);
    if (raw.length !== 32) throw new Error(`bad Solana address ${key}`);
    bytes.push(...raw);
  }
  const hash = base58Decode(blockhash);
  if (hash.length !== 32) throw new Error('bad blockhash');
  bytes.push(...hash, ...shortVec(targets.length));
  for (const t of targets) {
    bytes.push(index(t.tokenProgram), ...shortVec(2), index(t.tokenAccount), 0, ...shortVec(1), REVOKE);
  }
  return Uint8Array.from(bytes);
}

function refuse(reason: string): never {
  diag('error', 'APPROVALS', `blocked: ${reason}`);
  throw new Error(`Blocked by CoinMan safety check: ${reason}`);
}

/**
 * Reads a message back and refuses it unless the owner is the only signer
 * and every instruction is a token program's Revoke on one of `allowed`.
 */
export function checkRevokeMessage(message: Uint8Array, owner: string, allowed: string[]): void {
  try {
    const [signers, readonlySigned] = [message[0], message[1]];
    if (signers !== 1 || readonlySigned !== 0) refuse('the owner must be the only signer');
    let [count, at] = readShortVec(message, 3);
    const keys: string[] = [];
    for (let i = 0; i < count; i++, at += 32) keys.push(base58Encode(message.slice(at, at + 32)));
    if (keys[0] !== owner) refuse('the fee payer is not your address');
    at += 32; // blockhash
    let instructions: number;
    [instructions, at] = readShortVec(message, at);
    if (!instructions) refuse('empty transaction');
    for (let n = 0; n < instructions; n++) {
      const program = keys[message[at++]];
      if (!TOKEN_PROGRAMS.includes(program)) refuse(`instruction for program ${program}`);
      let len: number;
      [len, at] = readShortVec(message, at);
      const accountIdx = Array.from(message.slice(at, at + len));
      at += len;
      [len, at] = readShortVec(message, at);
      const data = Array.from(message.slice(at, at + len));
      at += len;
      if (data.length !== 1 || data[0] !== REVOKE) refuse('an instruction other than Revoke');
      if (accountIdx.length !== 2 || accountIdx[1] !== 0 || !allowed.includes(keys[accountIdx[0]])) {
        refuse('Revoke on an account that is not listed');
      }
    }
    if (at !== message.length) refuse('unexpected bytes after the instructions');
  } catch (err: any) {
    if (String(err?.message).startsWith('Blocked by CoinMan')) throw err;
    refuse('unreadable transaction');
  }
}

const unsignedTx = (message: Uint8Array) => Uint8Array.from([...shortVec(1), ...new Uint8Array(64), ...message]);

export interface SolanaRevokeBatch {
  approvals: Approval[];
  error?: string;
}

export async function prepareSolanaRevokes(owner: string, approvals: Approval[], signal: AbortSignal) {
  const balance = await rpc<{ value: number }>('getBalance', [owner], signal)
    .then((r) => BigInt(r.value))
    .catch(() => 0n);
  const batches: SolanaRevokeBatch[] = [];
  for (let i = 0; i < approvals.length; i += PER_TX) batches.push({ approvals: approvals.slice(i, i + PER_TX) });
  // A dry run of each batch against the live chain (no signature needed).
  const { blockhash } = (await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }], signal)).value;
  for (const batch of batches) {
    try {
      const message = buildRevokeMessage(owner, targetsOf(batch.approvals), blockhash);
      checkRevokeMessage(message, owner, batch.approvals.map((a) => a.tokenAccount!));
      const sim = await rpc<{ value: { err: unknown; logs?: string[] } }>(
        'simulateTransaction',
        [bytesToBase64(unsignedTx(message)), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }],
        signal
      );
      if (sim.value.err) batch.error = `would fail: ${JSON.stringify(sim.value.err)}`;
    } catch (err: any) {
      batch.error = err?.message ?? String(err);
    }
  }
  const total = FEE_LAMPORTS * BigInt(batches.length);
  return { batches, balance, total, blocker: balance < total ? 'Not enough SOL for the network fee' : undefined };
}

const targetsOf = (approvals: Approval[]): RevokeTarget[] =>
  approvals.map((a) => ({ tokenAccount: a.tokenAccount!, tokenProgram: a.tokenProgram! }));

/** Signs one batch in the wallet, sends it and waits until it is confirmed. */
export async function sendSolanaRevokes(owner: string, approvals: Approval[], signal: AbortSignal): Promise<{ ok: boolean; signature?: string; detail?: string }> {
  const { blockhash } = (await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }], signal)).value;
  const targets = targetsOf(approvals);
  const message = buildRevokeMessage(owner, targets, blockhash);
  checkRevokeMessage(message, owner, targets.map((t) => t.tokenAccount));

  const result = await signSolanaTransaction(bytesToBase64(unsignedTx(message)), {
    feePayer: owner,
    recentBlockhash: blockhash,
    instructions: targets.map((t) => ({
      programId: t.tokenProgram,
      data: base58Encode(Uint8Array.of(REVOKE)),
      keys: [
        { pubkey: t.tokenAccount, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
    })),
  });
  let signature: Uint8Array | null = null;
  if (result?.transaction) {
    // The wallet sent the whole transaction back: it must be ours, signed.
    const signed = base64ToBytes(result.transaction);
    const [count, at] = readShortVec(signed, 0);
    const returned = signed.slice(at + count * 64);
    if (count !== 1 || returned.length !== message.length || returned.some((b, i) => b !== message[i])) {
      refuse('the wallet returned a different transaction');
    }
    signature = signed.slice(at, at + 64);
  } else if (result?.signature) {
    signature = base58Decode(result.signature);
  }
  if (!signature || signature.length !== 64) throw new Error('The wallet returned no signature.');
  if (!ed25519.verify(signature, message, base58Decode(owner))) refuse('the signature is not for this transaction');

  const tx = Uint8Array.from([...shortVec(1), ...signature, ...message]);
  const sig = await rpc<string>('sendTransaction', [bytesToBase64(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }], signal);
  diag('info', 'APPROVALS', `Solana revoke of ${approvals.length} delegate(s) sent ${sig}`);
  for (let i = 0; i < 45 && !signal.aborted; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await rpc<{ value: any[] }>('getSignatureStatuses', [[sig]], signal).catch(() => null);
    const s = status?.value?.[0];
    if (s?.err) return { ok: false, signature: sig, detail: `failed: ${JSON.stringify(s.err)}` };
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return { ok: true, signature: sig };
  }
  return { ok: false, signature: sig, detail: 'not confirmed in time — check the explorer' };
}

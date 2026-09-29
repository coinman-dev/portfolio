import { decodeFunctionData, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import {
  getAccount,
  getCapabilities,
  sendCalls,
  sendTransaction,
  switchChain,
  waitForCallsStatus,
  waitForTransactionReceipt,
} from '@wagmi/core';
import { wagmiConfig } from '../../../wallet/wallet';
import { diag } from '../../../diag';
import { readClient } from '../chains';
import { Approval } from '../types';
import { permit2Address } from './events';

/**
 * Revoking on an EVM network. Every transaction is built here and checked
 * by `checkRevokeCall` before the wallet sees it: it may only take access
 * away (allowance to 0, collection access off, Permit2 lockdown) — never
 * grant it or move anything.
 */

const REVOKE_ABI = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function setApprovalForAll(address operator, bool approved)',
  'function lockdown((address token, address spender)[] approvals)',
]);

/** Permit2 pairs per lockdown transaction. */
const LOCKDOWN_CHUNK = 40;

export interface RevokeCall {
  to: Hex;
  data: Hex;
  /** Approvals this transaction ends. */
  ids: string[];
  label: string;
}

export function buildRevokeCalls(chainId: number, approvals: Approval[]): RevokeCall[] {
  const calls: RevokeCall[] = [];
  const viaPermit2 = approvals.filter((a) => a.kind === 'permit2');
  for (let i = 0; i < viaPermit2.length; i += LOCKDOWN_CHUNK) {
    const part = viaPermit2.slice(i, i + LOCKDOWN_CHUNK);
    calls.push({
      to: permit2Address(chainId) as Hex,
      data: encodeFunctionData({
        abi: REVOKE_ABI,
        functionName: 'lockdown',
        args: [part.map((a) => ({ token: a.token as Address, spender: a.spender as Address }))],
      }),
      ids: part.map((a) => a.id),
      label: part.length === 1 ? `${part[0].symbol} in Permit2` : `${part.length} Permit2 allowances`,
    });
  }
  for (const a of approvals) {
    if (a.kind === 'token') {
      calls.push({
        to: a.token as Hex,
        data: encodeFunctionData({ abi: REVOKE_ABI, functionName: 'approve', args: [a.spender as Address, 0n] }),
        ids: [a.id],
        label: a.symbol,
      });
    } else if (a.kind === 'nft-token') {
      calls.push({
        to: a.token as Hex,
        data: encodeFunctionData({ abi: REVOKE_ABI, functionName: 'approve', args: [zeroAddress, a.tokenId!] }),
        ids: [a.id],
        label: `${a.symbol} #${a.tokenId}`,
      });
    } else if (a.kind === 'nft-all') {
      calls.push({
        to: a.token as Hex,
        data: encodeFunctionData({ abi: REVOKE_ABI, functionName: 'setApprovalForAll', args: [a.spender as Address, false] }),
        ids: [a.id],
        label: `${a.symbol} (whole collection)`,
      });
    }
  }
  return calls;
}

function refuse(reason: string): never {
  diag('error', 'APPROVALS', `blocked: ${reason}`);
  throw new Error(`Blocked by CoinMan safety check: ${reason}`);
}

/**
 * The last word before the wallet: the call must take away one of the
 * listed approvals and do nothing else. Anything else is refused.
 */
export function checkRevokeCall(chainId: number, call: { to: string; data: string; value?: bigint }, approvals: Approval[]): void {
  if (call.value != null && call.value !== 0n) refuse('a revoke never sends coins');
  let decoded: ReturnType<typeof decodeFunctionData<typeof REVOKE_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: REVOKE_ABI, data: call.data as Hex });
  } catch {
    refuse('not a revoke transaction');
  }
  // Exactly the call and nothing appended to it.
  const again = encodeFunctionData({ abi: REVOKE_ABI, functionName: decoded.functionName, args: decoded.args } as any);
  if (again.toLowerCase() !== call.data.toLowerCase()) refuse('unexpected extra data in the transaction');
  const to = call.to.toLowerCase();

  if (decoded.functionName === 'approve') {
    const [spender, amount] = decoded.args as [Address, bigint];
    const s = spender.toLowerCase();
    const match = approvals.find(
      (a) =>
        a.token === to &&
        ((a.kind === 'token' && amount === 0n && a.spender === s) ||
          (a.kind === 'nft-token' && s === zeroAddress && a.tokenId === amount))
    );
    if (!match) refuse(`approve on ${to} is not the revoke of a listed approval`);
    return;
  }
  if (decoded.functionName === 'setApprovalForAll') {
    const [operator, approved] = decoded.args as [Address, boolean];
    if (approved !== false) refuse('turning collection access on');
    const match = approvals.find((a) => a.kind === 'nft-all' && a.token === to && a.spender === operator.toLowerCase());
    if (!match) refuse(`collection access on ${to} is not a listed approval`);
    return;
  }
  if (to !== permit2Address(chainId)) refuse(`lockdown sent to ${to}, not Permit2`);
  const [pairs] = decoded.args as [readonly { token: Address; spender: Address }[]];
  if (!pairs.length) refuse('empty Permit2 lockdown');
  for (const pair of pairs) {
    const match = approvals.find(
      (a) => a.kind === 'permit2' && a.token === pair.token.toLowerCase() && a.spender === pair.spender.toLowerCase()
    );
    if (!match) refuse(`Permit2 pair ${pair.token}/${pair.spender} is not listed`);
  }
}

// ─── Before sending: what it takes ──────────────────────────────────────────

export interface PreparedCall extends RevokeCall {
  gas?: bigint;
  /** Why it would fail right now (a dry run reverted). */
  error?: string;
}

export interface EvmChainPlan {
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  calls: PreparedCall[];
  gasPrice?: bigint;
  nativeBalance?: bigint;
  /** Fee for all sendable calls, in the native coin (with 20% headroom). */
  cost?: bigint;
  /** Stops the whole network, e.g. no coin for gas. */
  blocker?: string;
}

const shortError = (err: any) => String(err?.shortMessage ?? err?.message ?? err).split('\n')[0].slice(0, 160);

export async function prepareEvmChain(
  chainId: number,
  chainName: string,
  nativeSymbol: string,
  owner: Address,
  approvals: Approval[]
): Promise<EvmChainPlan> {
  const client = readClient(chainId);
  const calls: PreparedCall[] = buildRevokeCalls(chainId, approvals).map((call) => {
    checkRevokeCall(chainId, call, approvals);
    return { ...call };
  });
  // estimateGas doubles as the dry run: it fails for a call that would revert.
  await Promise.all(
    calls.map(async (call) => {
      try {
        call.gas = await client.estimateGas({ account: owner, to: call.to, data: call.data });
      } catch (err) {
        call.error = `would fail: ${shortError(err)}`;
      }
    })
  );
  const plan: EvmChainPlan = { chainId, chainName, nativeSymbol, calls };
  try {
    const [gasPrice, balance] = await Promise.all([client.getGasPrice(), client.getBalance({ address: owner })]);
    plan.gasPrice = gasPrice;
    plan.nativeBalance = balance;
    const gas = calls.reduce((sum, c) => sum + (c.error ? 0n : (c.gas ?? 0n)), 0n);
    plan.cost = (gas * gasPrice * 12n) / 10n;
    if (gas > 0n && balance < plan.cost) plan.blocker = `Not enough ${nativeSymbol} for gas`;
  } catch (err) {
    plan.blocker = `Cannot read the network: ${shortError(err)}`;
  }
  if (!plan.blocker && calls.every((c) => c.error)) plan.blocker = 'Every revoke here would fail';
  return plan;
}

// ─── Sending ────────────────────────────────────────────────────────────────

export type CallState = 'waiting' | 'wallet' | 'pending' | 'done' | 'failed' | 'skipped';

export interface CallProgress {
  index: number;
  state: CallState;
  hash?: Hex;
  detail?: string;
}

export const isUserRejection = (err: any) =>
  err?.code === 4001 || /reject|denied|cancel/i.test(String(err?.shortMessage ?? err?.message ?? err));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** One confirmation for the whole network, where the wallet can batch (EIP-5792). */
async function canBatch(chainId: number): Promise<boolean> {
  try {
    const caps: any = await withTimeout(getCapabilities(wagmiConfig, { chainId } as any), 5000);
    const status = caps?.atomic?.status ?? caps?.[chainId]?.atomic?.status;
    return status === 'supported' || status === 'ready';
  } catch {
    return false;
  }
}

/**
 * Sends one network's revokes. With batching the wallet asks once; without,
 * once per transaction. A declined transaction is skipped, the rest go on.
 */
export async function runEvmChain(
  plan: EvmChainPlan,
  owner: Address,
  approvals: Approval[],
  onProgress: (p: CallProgress) => void,
  shouldStop: () => boolean
): Promise<void> {
  const account = getAccount(wagmiConfig);
  if (!account.address || account.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('The connected wallet changed — scan again.');
  }
  if (account.chainId !== plan.chainId) {
    try {
      await switchChain(wagmiConfig, { chainId: plan.chainId as any });
    } catch (err) {
      if (isUserRejection(err)) throw new Error(`Switching to ${plan.chainName} was declined in the wallet.`);
      throw new Error(
        `The wallet did not switch to ${plan.chainName} (${shortError(err)}). If the wallet was connected before ` +
          'this network was added, remove it and connect again so it approves the new networks.'
      );
    }
  }

  const sendable = plan.calls.map((call, index) => ({ call, index })).filter(({ call }) => !call.error);
  plan.calls.forEach((call, index) => {
    if (call.error) onProgress({ index, state: 'skipped', detail: call.error });
  });
  for (const { call } of sendable) checkRevokeCall(plan.chainId, call, approvals);

  if (sendable.length > 1 && (await canBatch(plan.chainId))) {
    sendable.forEach(({ index }) => onProgress({ index, state: 'wallet' }));
    try {
      const { id } = await sendCalls(wagmiConfig, {
        account: owner,
        chainId: plan.chainId as any,
        calls: sendable.map(({ call }) => ({ to: call.to, data: call.data, value: 0n })),
      } as any);
      diag('info', 'APPROVALS', `${plan.chainName}: batch of ${sendable.length} revokes sent (${id})`);
      sendable.forEach(({ index }) => onProgress({ index, state: 'pending' }));
      const result: any = await waitForCallsStatus(wagmiConfig, { id, timeout: 10 * 60_000 } as any);
      const ok = result?.status === 'success';
      const hash = result?.receipts?.[0]?.transactionHash as Hex | undefined;
      sendable.forEach(({ index }) =>
        onProgress({ index, state: ok ? 'done' : 'failed', hash, detail: ok ? undefined : 'the batch failed' })
      );
      return;
    } catch (err) {
      if (isUserRejection(err)) {
        sendable.forEach(({ index }) => onProgress({ index, state: 'skipped', detail: 'declined in the wallet' }));
        return;
      }
      // The wallet could not batch after all: one by one below.
      diag('warn', 'APPROVALS', `${plan.chainName}: batch not accepted, sending one by one: ${shortError(err)}`);
      sendable.forEach(({ index }) => onProgress({ index, state: 'waiting' }));
    }
  }

  for (const { call, index } of sendable) {
    if (shouldStop()) {
      onProgress({ index, state: 'skipped', detail: 'stopped' });
      continue;
    }
    onProgress({ index, state: 'wallet' });
    let hash: Hex;
    try {
      hash = await sendTransaction(wagmiConfig, {
        account: owner,
        chainId: plan.chainId as any,
        to: call.to,
        data: call.data,
        value: 0n,
      });
    } catch (err) {
      onProgress({ index, state: 'skipped', detail: isUserRejection(err) ? 'declined in the wallet' : shortError(err) });
      continue;
    }
    diag('info', 'APPROVALS', `${plan.chainName}: revoke ${call.label} sent ${hash}`);
    onProgress({ index, state: 'pending', hash });
    try {
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: plan.chainId as any });
      onProgress({
        index,
        state: receipt.status === 'success' ? 'done' : 'failed',
        hash,
        detail: receipt.status === 'success' ? undefined : 'the transaction reverted',
      });
    } catch (err) {
      onProgress({ index, state: 'failed', hash, detail: `no receipt: ${shortError(err)}` });
    }
  }
}

import {
  getAccount,
  getPublicClient,
  readContract,
  sendTransaction,
  switchChain,
  waitForTransactionReceipt,
} from '@wagmi/core';
import { encodeFunctionData, parseAbi } from 'viem';
import { wagmiConfig } from '../../../wallet/wallet';
import { diag } from '../../../diag';
import { QuoteRequest } from '../types';
import { ExecPlan, checkPlan } from './plan';

type Hex = `0x${string}`;

export type RunStep = 'reset' | 'approve' | 'swap';

export interface RunProgress {
  step: RunStep;
  state: 'wallet' | 'pending' | 'done';
  hash?: Hex;
}

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

/** Where the wallet is on this plan, if anywhere: the steps it must go through. */
export async function pendingApprovals(plan: ExecPlan): Promise<RunStep[]> {
  if (!plan.token || !plan.spender) return [];
  const allowance = (await readContract(wagmiConfig, {
    chainId: plan.chainId as any,
    address: plan.token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [plan.user, plan.spender],
  })) as bigint;
  if (allowance >= plan.amount) return [];
  // USDT and a few others refuse to change a non-zero allowance directly.
  return allowance > 0n ? ['reset', 'approve'] : ['approve'];
}

async function send(
  plan: ExecPlan,
  step: RunStep,
  tx: { to: Hex; data: Hex; value: bigint },
  onProgress: (p: RunProgress) => void
): Promise<Hex> {
  onProgress({ step, state: 'wallet' });
  const hash = await sendTransaction(wagmiConfig, {
    account: plan.user,
    chainId: plan.chainId as any,
    to: tx.to,
    data: tx.data,
    value: tx.value,
  });
  diag('info', 'BESTRATE', `${plan.providerName} ${step} sent: ${hash}`);
  onProgress({ step, state: 'pending', hash });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: plan.chainId as any });
  if (receipt.status !== 'success') throw new Error(`The ${step} transaction reverted (${hash}).`);
  onProgress({ step, state: 'done', hash });
  return hash;
}

/**
 * Approves exactly the input (resetting first where the token needs it),
 * dry-runs the swap against the live chain, then sends it. Returns the
 * swap's transaction hash.
 */
export async function runPlan(
  plan: ExecPlan,
  req: QuoteRequest,
  onProgress: (p: RunProgress) => void
): Promise<Hex> {
  checkPlan(plan, req);
  const account = getAccount(wagmiConfig);
  if (!account.address || account.address.toLowerCase() !== plan.user.toLowerCase()) {
    throw new Error('The connected wallet changed — review the swap again.');
  }
  if (account.chainId !== plan.chainId) {
    await switchChain(wagmiConfig, { chainId: plan.chainId as any });
  }

  const approveTx = (amount: bigint) => ({
    to: plan.token as Hex,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [plan.spender as Hex, amount] }),
    value: 0n,
  });
  for (const step of await pendingApprovals(plan)) {
    await send(plan, step, approveTx(step === 'reset' ? 0n : plan.amount), onProgress);
  }

  // With the allowance in place the swap can be tried for real, without sending.
  const client = getPublicClient(wagmiConfig, { chainId: plan.chainId as any });
  try {
    await client.call({ account: plan.user, to: plan.tx.to, data: plan.tx.data, value: plan.tx.value });
  } catch (err: any) {
    throw new Error(`The swap would fail right now (${err?.shortMessage ?? err?.message ?? err}). It was not sent.`);
  }
  return send(plan, 'swap', plan.tx, onProgress);
}

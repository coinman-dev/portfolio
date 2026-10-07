import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi } from 'viem';
import { ExecPlan } from './plan';

/**
 * Public RPCs that run `eth_simulateV1` (checked 2026-09-29). On other chains
 * each step is still dry-run with `eth_call` right before it is sent.
 */
const SIMULATION_RPC: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  56: 'https://bsc-rpc.publicnode.com',
  10: 'https://optimism-rpc.publicnode.com',
  59144: 'https://linea-rpc.publicnode.com',
  100: 'https://gnosis-rpc.publicnode.com',
};

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function balanceOf(address owner) view returns (uint256)',
]);
const MULTICALL_ABI = parseAbi(['function getEthBalance(address addr) view returns (uint256)']);

export interface SimulationResult {
  supported: boolean;
  ok: boolean;
  /** Same-chain swaps: how much of the output token the wallet gained. */
  received?: bigint;
  error?: string;
}

type Hex = `0x${string}`;

/** A read of `owner`'s balance of `token` (null = native coin) as a call. */
function balanceCall(token: Hex | null, owner: Hex) {
  return token
    ? { to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }) }
    : { to: MULTICALL3 as Hex, data: encodeFunctionData({ abi: MULTICALL_ABI, functionName: 'getEthBalance', args: [owner] }) };
}

function decodeBalance(token: Hex | null, data: Hex | undefined): bigint {
  if (!data || data === '0x') return 0n;
  return token
    ? (decodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', data }) as bigint)
    : (decodeFunctionResult({ abi: MULTICALL_ABI, functionName: 'getEthBalance', data }) as bigint);
}

/**
 * Runs approve + swap from the user's own address against the latest block.
 * For a same-chain swap it also reads the output balance before and after,
 * so a route that pays someone else — or less than promised — shows up here.
 */
export async function simulatePlan(plan: ExecPlan, outToken: Hex | null, signal?: AbortSignal): Promise<SimulationResult> {
  const rpc = SIMULATION_RPC[plan.chainId];
  if (!rpc) return { supported: false, ok: false };
  const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, fetchOptions: { signal } }) });

  const receiver = plan.receiver as Hex;
  const calls: { to: Hex; data?: Hex; value?: bigint }[] = [];
  const checkOutput = plan.sameChain;
  if (checkOutput) calls.push(balanceCall(outToken, receiver));
  if (plan.token && plan.spender) {
    calls.push({
      to: plan.token,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [plan.spender, plan.amount] }),
    });
  }
  const mainIndex = calls.length;
  calls.push({ to: plan.tx.to, data: plan.tx.data, value: plan.tx.value });
  if (checkOutput) calls.push(balanceCall(outToken, receiver));

  try {
    const { results } = await client.simulateCalls({ account: plan.user, calls });
    const failed = results.findIndex((r) => r.status !== 'success');
    if (failed !== -1) {
      const what = failed === mainIndex ? 'the swap' : failed < mainIndex ? 'the approval' : 'a balance check';
      return { supported: true, ok: false, error: `${what} would fail: ${results[failed].error?.message ?? 'reverted'}` };
    }
    if (!checkOutput) return { supported: true, ok: true };
    const before = decodeBalance(outToken, results[0].data);
    const after = decodeBalance(outToken, results[results.length - 1].data);
    // Simulation charges no gas, so a native-coin balance moves only by the swap.
    const received = after - before;
    if (received < plan.toAmountMin) {
      return {
        supported: true,
        ok: false,
        received,
        error: 'the simulated swap pays less than the minimum you would accept',
      };
    }
    return { supported: true, ok: true, received };
  } catch (err: any) {
    return { supported: true, ok: false, error: err?.shortMessage ?? err?.message ?? String(err) };
  }
}

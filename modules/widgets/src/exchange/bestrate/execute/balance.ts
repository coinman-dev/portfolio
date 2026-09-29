import { getBalance, readContract } from '@wagmi/core';
import { parseAbi } from 'viem';
import { wagmiConfig } from '../../../wallet/wallet';

const BALANCE_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

type Hex = `0x${string}`;

/** `owner`'s balance of `token` (null = the chain's native coin), on a wallet chain. */
export async function readBalance(chainId: number, token: Hex | null, owner: Hex): Promise<bigint> {
  if (!token) {
    const { value } = await getBalance(wagmiConfig, { chainId: chainId as any, address: owner });
    return value;
  }
  return (await readContract(wagmiConfig, {
    chainId: chainId as any,
    address: token,
    abi: BALANCE_ABI,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint;
}

/** Turns the usual "cannot pull the tokens" reverts into plain words. */
export function explainRevert(message: string, symbol: string): string {
  if (/TRANSFER_FROM_FAILED|exceeds balance|insufficient (funds|balance)|transfer amount exceeds/i.test(message)) {
    return `the wallet does not hold enough ${symbol} for this amount.`;
  }
  if (/allowance/i.test(message)) return `the ${symbol} approval is missing or too small.`;
  return message;
}

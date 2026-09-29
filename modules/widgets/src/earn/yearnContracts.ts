import {
  readContract,
  writeContract,
  waitForTransactionReceipt,
  switchChain,
} from '@wagmi/core';
import { wagmiConfig } from '../wallet/wallet';

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const;

export const ERC4626_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pricePerShare',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;




/**
 * Ensure user is on the correct chain before transaction
 */
export async function ensureChain(targetChainId: number): Promise<void> {
  try {
    await switchChain(wagmiConfig, { chainId: targetChainId as any });
  } catch (err) {
    console.warn(`[YearnContracts] Chain switch request failed or rejected:`, err);
    throw new Error(`Please switch your wallet network to chain ID ${targetChainId}`);
  }
}







/**
 * yvUSD Locked. Signatures verified against the deployed sources on Sourcify:
 * `LockerZapper` (0x7ba6…2bbA) and `LockedyvUSD` (0xAaaF…9040).
 * Only the two-argument overloads are declared so viem never has to
 * disambiguate `zapIn`/`zapOut`.
 */
export const LOCKER_ZAPPER_ABI = [
  {
    type: 'function',
    name: 'previewZapIn',
    stateMutability: 'view',
    inputs: [{ name: '_amount', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewZapOut',
    stateMutability: 'view',
    inputs: [{ name: '_shares', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'zapIn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_amount', type: 'uint256' },
      { name: '_receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'zapOut',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_shares', type: 'uint256' },
      { name: '_receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const LOCKED_VAULT_ABI = [
  {
    type: 'function',
    name: 'getCooldownStatus',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'cooldownEnd', type: 'uint256' },
      { name: 'windowEnd', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'cooldownDuration',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdrawalWindow',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'startCooldown',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelCooldown',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

export interface LockedCooldown {
  /** Unix seconds; 0 when no cooldown was ever started. */
  cooldownEnd: number;
  windowEnd: number;
  /** Shares the cooldown was started for. */
  shares: bigint;
}

export async function fetchLockedCooldown(
  chainId: number,
  lockedVaultAddress: string,
  userAddress: string
): Promise<LockedCooldown> {
  try {
    const result = (await readContract(wagmiConfig, {
      chainId: chainId as any,
      address: lockedVaultAddress as `0x${string}`,
      abi: LOCKED_VAULT_ABI,
      functionName: 'getCooldownStatus',
      args: [userAddress as `0x${string}`],
    })) as readonly [bigint, bigint, bigint];
    return {
      cooldownEnd: Number(result[0]),
      windowEnd: Number(result[1]),
      shares: result[2],
    };
  } catch (err) {
    console.warn('[YearnContracts] Failed to read cooldown status:', err);
    return { cooldownEnd: 0, windowEnd: 0, shares: 0n };
  }
}

/** Cooldown duration and withdrawal window, in seconds, as configured on-chain. */
export async function fetchLockedSchedule(
  chainId: number,
  lockedVaultAddress: string
): Promise<{ cooldownDuration: number; withdrawalWindow: number } | null> {
  try {
    const [duration, window] = await Promise.all([
      readContract(wagmiConfig, {
        chainId: chainId as any,
        address: lockedVaultAddress as `0x${string}`,
        abi: LOCKED_VAULT_ABI,
        functionName: 'cooldownDuration',
      }),
      readContract(wagmiConfig, {
        chainId: chainId as any,
        address: lockedVaultAddress as `0x${string}`,
        abi: LOCKED_VAULT_ABI,
        functionName: 'withdrawalWindow',
      }),
    ]);
    return { cooldownDuration: Number(duration), withdrawalWindow: Number(window) };
  } catch (err) {
    console.warn('[YearnContracts] Failed to read cooldown schedule:', err);
    return null;
  }
}


/** Base asset the given locked shares would return, via the zapper. */
export async function previewZapOut(
  chainId: number,
  zapAddress: string,
  shares: bigint
): Promise<bigint> {
  try {
    return (await readContract(wagmiConfig, {
      chainId: chainId as any,
      address: zapAddress as `0x${string}`,
      abi: LOCKER_ZAPPER_ABI,
      functionName: 'previewZapOut',
      args: [shares],
    })) as bigint;
  } catch {
    return 0n;
  }
}



/** Arms the withdrawal cooldown for `shares`; overwrites any pending cooldown. */
export async function startLockedCooldown(
  chainId: number,
  lockedVaultAddress: string,
  shares: bigint
): Promise<string> {
  await ensureChain(chainId);

  const hash = await writeContract(wagmiConfig, {
    chainId: chainId as any,
    address: lockedVaultAddress as `0x${string}`,
    abi: LOCKED_VAULT_ABI,
    functionName: 'startCooldown',
    args: [shares],
  });

  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

export async function cancelLockedCooldown(
  chainId: number,
  lockedVaultAddress: string
): Promise<string> {
  await ensureChain(chainId);

  const hash = await writeContract(wagmiConfig, {
    chainId: chainId as any,
    address: lockedVaultAddress as `0x${string}`,
    abi: LOCKED_VAULT_ABI,
    functionName: 'cancelCooldown',
  });

  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

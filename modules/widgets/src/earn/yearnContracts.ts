import {
  readContract,
  writeContract,
  waitForTransactionReceipt,
  switchChain,
} from '@wagmi/core';
import { formatUnits, maxUint256 } from 'viem';
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
 * Fetch token balance of a user
 */
export async function fetchUserTokenBalance(
  chainId: number,
  tokenAddress: string,
  userAddress: string,
  decimals: number
): Promise<{ raw: bigint; formatted: string }> {
  try {
    const balance = (await readContract(wagmiConfig, {
      chainId: chainId as any,
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [userAddress as `0x${string}`],
    })) as bigint;

    return {
      raw: balance,
      formatted: formatUnits(balance, decimals),
    };
  } catch (err) {
    console.warn(`[YearnContracts] Failed to fetch balance for ${tokenAddress}:`, err);
    return { raw: 0n, formatted: '0' };
  }
}

/**
 * Fetch user's vault balance (shares and equivalent underlying assets)
 */
export async function fetchUserVaultBalance(
  chainId: number,
  vaultAddress: string,
  userAddress: string,
  tokenDecimals: number
): Promise<{
  shares: bigint;
  formattedShares: string;
  underlyingAssets: bigint;
  formattedAssets: string;
}> {
  try {
    const shares = (await readContract(wagmiConfig, {
      chainId: chainId as any,
      address: vaultAddress as `0x${string}`,
      abi: ERC4626_ABI,
      functionName: 'balanceOf',
      args: [userAddress as `0x${string}`],
    })) as bigint;

    if (shares === 0n) {
      return {
        shares: 0n,
        formattedShares: '0',
        underlyingAssets: 0n,
        formattedAssets: '0',
      };
    }

    let underlying = shares;
    try {
      // Try ERC-4626 convertToAssets
      underlying = (await readContract(wagmiConfig, {
        chainId: chainId as any,
        address: vaultAddress as `0x${string}`,
        abi: ERC4626_ABI,
        functionName: 'convertToAssets',
        args: [shares],
      })) as bigint;
    } catch {
      try {
        // Fallback for Yearn V2: pricePerShare
        const pps = (await readContract(wagmiConfig, {
          chainId: chainId as any,
          address: vaultAddress as `0x${string}`,
          abi: ERC4626_ABI,
          functionName: 'pricePerShare',
        })) as bigint;
        const decimalsBig = 10n ** BigInt(tokenDecimals);
        underlying = (shares * pps) / decimalsBig;
      } catch {
        underlying = shares;
      }
    }

    return {
      shares,
      formattedShares: formatUnits(shares, tokenDecimals),
      underlyingAssets: underlying,
      formattedAssets: formatUnits(underlying, tokenDecimals),
    };
  } catch (err) {
    console.warn(`[YearnContracts] Failed to fetch vault shares for ${vaultAddress}:`, err);
    return {
      shares: 0n,
      formattedShares: '0',
      underlyingAssets: 0n,
      formattedAssets: '0',
    };
  }
}

/**
 * Check if the user has approved the vault to spend tokens
 */
export async function fetchAllowance(
  chainId: number,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint> {
  try {
    const allowance = (await readContract(wagmiConfig, {
      chainId: chainId as any,
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`],
    })) as bigint;
    return allowance;
  } catch (err) {
    console.warn(`[YearnContracts] Failed to check allowance for ${tokenAddress}:`, err);
    return 0n;
  }
}

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
 * Approve vault to spend token
 */
export async function approveToken(
  chainId: number,
  tokenAddress: string,
  vaultAddress: string,
  amount: bigint = maxUint256
): Promise<string> {
  await ensureChain(chainId);

  const hash = await writeContract(wagmiConfig, {
    chainId: chainId as any,
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [vaultAddress as `0x${string}`, amount],
  });

  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * Deposit assets into Yearn vault
 */
export async function depositToVault(
  chainId: number,
  vaultAddress: string,
  assets: bigint,
  receiverAddress: string
): Promise<string> {
  await ensureChain(chainId);

  const hash = await writeContract(wagmiConfig, {
    chainId: chainId as any,
    address: vaultAddress as `0x${string}`,
    abi: ERC4626_ABI,
    functionName: 'deposit',
    args: [assets, receiverAddress as `0x${string}`],
  });

  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * Redeem vault shares back to underlying assets
 */
export async function redeemFromVault(
  chainId: number,
  vaultAddress: string,
  shares: bigint,
  userAddress: string
): Promise<string> {
  await ensureChain(chainId);

  const hash = await writeContract(wagmiConfig, {
    chainId: chainId as any,
    address: vaultAddress as `0x${string}`,
    abi: ERC4626_ABI,
    functionName: 'redeem',
    args: [shares, userAddress as `0x${string}`, userAddress as `0x${string}`],
  });

  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

export async function getTokenBalance(
  chainId: number,
  tokenAddress: string,
  userAddress: string
): Promise<bigint> {
  const res = await fetchUserTokenBalance(chainId, tokenAddress, userAddress, 18);
  return res.raw;
}

export const getTokenAllowance = fetchAllowance;

export async function getUserVaultShares(
  chainId: number,
  vaultAddress: string,
  userAddress: string
): Promise<{ shares: bigint; assetsUnderlying: bigint }> {
  const res = await fetchUserVaultBalance(chainId, vaultAddress, userAddress, 18);
  return { shares: res.shares, assetsUnderlying: res.underlyingAssets };
}

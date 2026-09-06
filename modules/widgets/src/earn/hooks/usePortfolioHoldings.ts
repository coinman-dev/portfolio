import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readContracts } from '@wagmi/core';
import { YearnVault } from '../types';
import { getVaultKey } from '../vaultMeta';
import { wagmiConfig } from '../../wallet/wallet';
import { ERC20_ABI, ERC4626_ABI } from '../yearnContracts';

/** Multicall payload size. Large enough to keep RPC round-trips low, small
 *  enough that a failing batch stays cheap. */
const BATCH_SIZE = 120;

export interface PortfolioPosition {
  vault: YearnVault;
  key: string;
  /** Shares expressed in the vault's own units. */
  shares: bigint;
  /** Shares converted to the deposit asset. */
  assets: bigint;
  usdValue: number;
}

export interface PortfolioHoldings {
  positions: PortfolioPosition[];
  /** Keyed by `getVaultKey` — feeds the Holdings column of the vaults list. */
  holdings: Record<string, number>;
  totalUsd: number;
  isLoading: boolean;
  refresh: () => void;
}

const EMPTY_HOLDINGS: Record<string, number> = {};

interface ShareSource {
  chainId: number;
  vaultKey: string;
  address: string;
  /** A wrapper (locked twin, staking contract) mints its own shares over the
   *  vault's, so its balance has to be converted before it can be summed. */
  isWrapper: boolean;
}

function shareSources(vault: YearnVault): ShareSource[] {
  const key = getVaultKey(vault);
  const sources: ShareSource[] = [
    { chainId: vault.chainID, vaultKey: key, address: vault.address, isWrapper: false },
  ];
  if (vault.lockedTwin?.address) {
    sources.push({
      chainId: vault.chainID,
      vaultKey: key,
      address: vault.lockedTwin.address,
      isWrapper: true,
    });
  }
  if (vault.staking?.address && vault.staking.address !== vault.address) {
    sources.push({
      chainId: vault.chainID,
      vaultKey: key,
      address: vault.staking.address,
      isWrapper: true,
    });
  }
  return sources;
}

/**
 * Groups by chain first, then splits into multicall-sized batches.
 * `readContracts` falls back to one RPC round-trip *per contract* when a batch
 * throws, so a single unreachable chain must not drag other chains' calls into
 * that fallback with it.
 */
function batchesByChain<T extends { chainId: number }>(items: T[], size: number): T[][] {
  const byChain = new Map<number, T[]>();
  for (const item of items) {
    const bucket = byChain.get(item.chainId);
    if (bucket) bucket.push(item);
    else byChain.set(item.chainId, [item]);
  }

  const out: T[][] = [];
  for (const bucket of byChain.values()) {
    for (let i = 0; i < bucket.length; i += size) out.push(bucket.slice(i, i + size));
  }
  return out;
}

/**
 * Scans every vault the list knows about — not a fixed prefix of it — for the
 * connected wallet's shares. Reads are grouped per chain and issued through
 * `readContracts`, which folds them into Multicall3 calls.
 */
export function usePortfolioHoldings(
  vaults: YearnVault[],
  walletAddress?: string
): PortfolioHoldings {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const runIdRef = useRef(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const runId = ++runIdRef.current;

    if (!walletAddress || vaults.length === 0) {
      setPositions([]);
      setIsLoading(false);
      return;
    }

    const isStale = () => runIdRef.current !== runId;

    /** Runs `contracts` in per-chain multicall batches, keeping input order. */
    const readAll = async <T extends { chainId: number }>(
      items: T[],
      toContract: (item: T) => any,
      onResult: (item: T, value: bigint) => void
    ) => {
      for (const batch of batchesByChain(items, BATCH_SIZE)) {
        if (isStale()) return false;
        const results = await readContracts(wagmiConfig, {
          allowFailure: true,
          contracts: batch.map(toContract),
        });
        results.forEach((result, index) => {
          if (result.status !== 'success') return;
          onResult(batch[index], result.result as bigint);
        });
      }
      return true;
    };

    const scan = async () => {
      setIsLoading(true);
      try {
        const owner = walletAddress as `0x${string}`;
        const sources = vaults.flatMap(shareSources);

        // Pass 1 — share balances of every vault, locked twin and staking contract.
        const balances = new Map<ShareSource, bigint>();
        if (
          !(await readAll(
            sources,
            (source) => ({
              chainId: source.chainId as any,
              address: source.address as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'balanceOf' as const,
              args: [owner] as const,
            }),
            (source, value) => {
              if (value > 0n) balances.set(source, value);
            }
          ))
        ) {
          return;
        }

        // Pass 2 — wrapper shares are worth a different number of vault shares,
        // so convert them before they can be added to the vault's own balance.
        const sharesByKey = new Map<string, bigint>();
        const add = (key: string, value: bigint) =>
          sharesByKey.set(key, (sharesByKey.get(key) ?? 0n) + value);

        const wrappers: ShareSource[] = [];
        for (const [source, value] of balances) {
          if (source.isWrapper) wrappers.push(source);
          else add(source.vaultKey, value);
        }

        const convertedWrappers = new Set<ShareSource>();
        if (
          !(await readAll(
            wrappers,
            (source) => ({
              chainId: source.chainId as any,
              address: source.address as `0x${string}`,
              abi: ERC4626_ABI,
              functionName: 'convertToAssets' as const,
              args: [balances.get(source) as bigint] as const,
            }),
            (source, value) => {
              convertedWrappers.add(source);
              add(source.vaultKey, value);
            }
          ))
        ) {
          return;
        }

        // Wrappers that do not expose convertToAssets fall back to 1:1.
        for (const source of wrappers) {
          if (!convertedWrappers.has(source)) add(source.vaultKey, balances.get(source) as bigint);
        }

        const held = vaults.filter((vault) => sharesByKey.has(getVaultKey(vault)));

        // Pass 3 — vault shares to the deposit asset.
        const assetsByKey = new Map<string, bigint>();
        const conversions = held.map((vault) => ({ chainId: vault.chainID, vault }));
        if (
          !(await readAll(
            conversions,
            ({ vault }) => ({
              chainId: vault.chainID as any,
              address: vault.address as `0x${string}`,
              abi: ERC4626_ABI,
              functionName: 'convertToAssets' as const,
              args: [sharesByKey.get(getVaultKey(vault)) as bigint] as const,
            }),
            ({ vault }, value) => assetsByKey.set(getVaultKey(vault), value)
          ))
        ) {
          return;
        }

        // Pass 4 — Yearn V2 vaults have no convertToAssets; use pricePerShare.
        const missing = held
          .filter((vault) => !assetsByKey.has(getVaultKey(vault)))
          .map((vault) => ({ chainId: vault.chainID, vault }));
        if (missing.length > 0) {
          if (
            !(await readAll(
              missing,
              ({ vault }) => ({
                chainId: vault.chainID as any,
                address: vault.address as `0x${string}`,
                abi: ERC4626_ABI,
                functionName: 'pricePerShare' as const,
              }),
              ({ vault }, pps) => {
                const key = getVaultKey(vault);
                const shares = sharesByKey.get(key) as bigint;
                const unit = 10n ** BigInt(vault.decimals ?? vault.token.decimals ?? 18);
                assetsByKey.set(key, pps > 0n ? (shares * pps) / unit : shares);
              }
            ))
          ) {
            return;
          }
        }

        const next: PortfolioPosition[] = held.map((vault) => {
          const key = getVaultKey(vault);
          const shares = sharesByKey.get(key) as bigint;
          const assets = assetsByKey.get(key) ?? shares;
          const decimals = vault.token.decimals || 18;
          const amount = Number(assets) / 10 ** decimals;
          return { vault, key, shares, assets, usdValue: amount * (vault.tvl?.price || 0) };
        });

        next.sort((a, b) => b.usdValue - a.usdValue);
        setPositions(next);
      } catch (err) {
        console.warn('[usePortfolioHoldings] Balance scan failed:', err);
        if (!isStale()) setPositions([]);
      } finally {
        if (!isStale()) setIsLoading(false);
      }
    };

    void scan();
  }, [vaults, walletAddress, nonce]);

  const holdings = useMemo(() => {
    if (positions.length === 0) return EMPTY_HOLDINGS;
    const map: Record<string, number> = {};
    for (const position of positions) map[position.key] = position.usdValue;
    return map;
  }, [positions]);

  const totalUsd = useMemo(
    () => positions.reduce((sum, position) => sum + position.usdValue, 0),
    [positions]
  );

  return { positions, holdings, totalUsd, isLoading, refresh };
}

import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ActivityEntry,
  ActivityFilters,
  fetchActivityChainIds,
  fetchActivityPage,
  isRetryableHoldingsError,
} from '../holdingsApi';
import { fetchKongVaultIndex } from '../kongApi';
import { YearnVault } from '../types';

/** yearn.fi's `usePortfolioActivity` settings. */
const PAGE_SIZE = 10;
const retry = (failureCount: number, error: unknown) =>
  isRetryableHoldingsError(error) && failureCount < 3;
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

export function useActivity(address: string | undefined, filters: ActivityFilters) {
  return useInfiniteQuery({
    queryKey: [
      'yearn-activity',
      address?.toLowerCase(),
      filters.type ?? 'all',
      filters.chainId ?? null,
      filters.startTimestamp ?? null,
      filters.endTimestamp ?? null,
    ],
    queryFn: ({ pageParam }) => fetchActivityPage(address as string, filters, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: Boolean(address),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry,
    retryDelay,
  });
}

export function useActivityChainIds(address: string | undefined) {
  return useQuery({
    queryKey: ['yearn-activity-facets', address?.toLowerCase()],
    queryFn: () => fetchActivityChainIds(address as string),
    enabled: Boolean(address),
    staleTime: 5 * 60_000,
    retry,
    retryDelay,
  });
}

/** Kong's vault list is ~2 MB; keep it around rather than refetch per visit. */
export function useKongVaultIndex() {
  return useQuery({
    queryKey: ['kong-vault-index'],
    queryFn: fetchKongVaultIndex,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}

/** How far back the vault widget looks for this vault's transactions. */
const RECENT_WINDOW = 50;

/**
 * The vault widget's "Recent transactions". yearn.fi fills it from the
 * browser's own record of transactions sent from the site; this app keeps no
 * such record, so it takes the wallet's latest indexed activity on the vault's
 * chain and keeps the entries that touched this vault or a contract merged
 * into its row (st-yBOLD, locked yvUSD, a staking wrapper).
 */
export function useVaultRecentActivity(
  address: string | undefined,
  vault: YearnVault,
  count = 3
): { entries: ActivityEntry[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['yearn-activity-recent', address?.toLowerCase(), vault.chainID],
    queryFn: () =>
      fetchActivityPage(address as string, { chainId: vault.chainID }, 0, RECENT_WINDOW),
    enabled: Boolean(address),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry,
    retryDelay,
  });

  const entries = useMemo(() => {
    const addresses = new Set(
      [vault.address, vault.dataAddress, vault.lockedTwin?.address, vault.staking?.address]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase())
    );
    return (query.data?.entries ?? [])
      .filter(
        (entry) =>
          addresses.has(entry.vaultAddress.toLowerCase()) ||
          addresses.has(entry.familyVaultAddress.toLowerCase())
      )
      .slice(0, count);
  }, [query.data, vault, count]);

  return { entries, isLoading: query.isLoading };
}

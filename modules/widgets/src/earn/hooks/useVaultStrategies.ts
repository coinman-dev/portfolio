import { useEffect, useState } from 'react';
import { YearnVault } from '../types';
import { KongCompositionEntry, fetchVaultSnapshot } from '../kongApi';

export interface StrategyRow {
  address: string;
  name: string;
  status: 'active' | 'not_active' | 'unallocated';
  /** Fraction of vault debt, 0..1. */
  allocation: number;
  /** USD value of the strategy debt. */
  amount: number;
  apy: number | null;
  performanceFee: number;
  lastReport: number;
}

export interface VaultStrategiesData {
  strategies: StrategyRow[];
  /** Idle assets not deployed to any strategy. */
  unallocated: { allocation: number; amount: number } | null;
  isLoading: boolean;
}

function pickNumber(...values: (number | null | undefined)[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * yearn.fi renders the strategy table from the Kong snapshot `composition`
 * array, which lists every strategy in the queue (yDaemon only returns the
 * allocated ones) and carries the estimated APY shown in the APY column.
 */
function mapComposition(
  entries: KongCompositionEntry[],
  totalAssets: bigint,
  decimals: number,
  price: number
): StrategyRow[] {
  return entries
    .map((entry) => {
      const address = entry.address || entry.strategy || '';
      if (!address || /^0x0{40}$/i.test(address)) return null;

      const totalDebtRaw = entry.totalDebt && entry.totalDebt !== '0' ? entry.totalDebt : entry.currentDebt;
      let debt = 0n;
      try {
        debt = BigInt(totalDebtRaw || '0');
      } catch {
        debt = 0n;
      }

      const computedRatio = totalAssets > 0n ? Number((debt * 10000n) / totalAssets) : 0;
      const ratio = typeof entry.debtRatio === 'number' ? entry.debtRatio : computedRatio;
      const hasAllocation = debt > 0n || ratio > 0;

      const estimated = pickNumber(
        entry.performance?.estimated?.apy,
        entry.performance?.oracle?.netAPY,
        entry.performance?.oracle?.apy
      );
      const historical = hasAllocation
        ? pickNumber(entry.performance?.historical?.net, entry.latestReportApr)
        : null;

      const lastReportRaw = Number(entry.lastReport || 0);
      return {
        address,
        name: entry.name?.trim() || `Strategy ${address.slice(0, 8)}`,
        status: (hasAllocation ? 'active' : 'not_active') as StrategyRow['status'],
        allocation: ratio / 10000,
        amount: (Number(debt) / 10 ** decimals) * price,
        apy: estimated ?? historical,
        performanceFee: Number(entry.performanceFee || 0),
        lastReport: lastReportRaw > 1e12 ? Math.floor(lastReportRaw / 1000) : lastReportRaw,
      };
    })
    .filter(Boolean) as StrategyRow[];
}

/** Kong snapshot composition for a vault, normalised into table rows. */
export function useVaultStrategies(vault: YearnVault): VaultStrategiesData {
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [unallocated, setUnallocated] = useState<VaultStrategiesData['unallocated']>(null);
  const [isLoading, setIsLoading] = useState(true);

  const chainId = vault.chainID;
  const address = vault.address;
  const decimals = vault.token?.decimals ?? 18;
  const price = vault.tvl?.price || 0;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetchVaultSnapshot(chainId, address)
      .then((snapshot) => {
        if (cancelled) return;
        const composition = snapshot?.composition;
        if (!composition?.length) {
          setStrategies([]);
          setUnallocated(null);
          return;
        }

        let totalAssets = 0n;
        try {
          totalAssets = BigInt(String(snapshot?.totalAssets ?? '0'));
        } catch {
          totalAssets = 0n;
        }

        const rows = mapComposition(composition, totalAssets, decimals, price);
        setStrategies(rows);

        const allocatedRatio = rows.reduce((acc, row) => acc + row.allocation, 0);
        const allocatedAmount = rows.reduce((acc, row) => acc + row.amount, 0);
        const totalUsd = (Number(totalAssets) / 10 ** decimals) * price;
        const idleRatio = Math.max(0, 1 - allocatedRatio);
        const idleAmount = Math.max(0, totalUsd - allocatedAmount);
        setUnallocated(
          idleRatio > 0 && idleAmount > 0 ? { allocation: idleRatio, amount: idleAmount } : null
        );
      })
      .catch(() => {
        if (!cancelled) {
          setStrategies([]);
          setUnallocated(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chainId, address, decimals, price]);

  return { strategies, unallocated, isLoading };
}

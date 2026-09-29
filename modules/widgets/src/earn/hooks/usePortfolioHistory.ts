import { useQuery } from '@tanstack/react-query';
import {
  BalanceDenomination,
  HoldingsNetworkError,
  HoldingsTimeframe,
  fetchBalanceHistory,
  fetchProtocolReturnHistory,
} from '../holdingsApi';

/** History only changes once a day settles; yearn.fi caches it for an hour. */
const STALE_MS = 60 * 60 * 1000;

const retryNetworkErrors = (failureCount: number, error: unknown) =>
  error instanceof HoldingsNetworkError && failureCount < 2;

export function useBalanceHistory(
  address: string | undefined,
  denomination: BalanceDenomination,
  timeframe: HoldingsTimeframe,
  enabled = true
) {
  return useQuery({
    queryKey: ['yearn-holdings-history', address?.toLowerCase(), denomination, timeframe],
    queryFn: () => fetchBalanceHistory(address as string, denomination, timeframe),
    enabled: enabled && Boolean(address),
    staleTime: STALE_MS,
    retry: retryNetworkErrors,
  });
}

/** Also feeds the All-Time Annualized Return metric, which is cumulative since
 *  the first deposit and therefore the same for both timeframes. */
export function useProtocolReturnHistory(
  address: string | undefined,
  timeframe: HoldingsTimeframe,
  enabled = true
) {
  return useQuery({
    queryKey: ['yearn-holdings-protocol-return', address?.toLowerCase(), timeframe],
    queryFn: () => fetchProtocolReturnHistory(address as string, timeframe),
    enabled: enabled && Boolean(address),
    staleTime: STALE_MS,
    retry: retryNetworkErrors,
  });
}

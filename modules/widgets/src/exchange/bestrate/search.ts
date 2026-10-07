import { NoRoute, Provider, ProviderId, QuoteRequest, RouteQuote } from './types';
import { amountUSD } from './providers/common';
import { lifiProvider, jumperUrl } from './providers/lifi';
import { socketProvider } from './providers/socket';
import { relayProvider } from './providers/relay';
import { kyberswapProvider } from './providers/kyberswap';
import { cowProvider } from './providers/cow';
import { debridgeProvider } from './providers/debridge';
import { nearProvider } from './providers/near';

export const PROVIDERS: Provider[] = [
  socketProvider,
  relayProvider,
  kyberswapProvider,
  cowProvider,
  debridgeProvider,
  nearProvider,
  lifiProvider,
];

/** What each service charges for itself, as published — shown in settings. */
export const PROVIDER_FEES: Record<ProviderId, string> = {
  socket: '0% with an API key; the public API adds its own',
  relay: '0% same-token bridging, 0.01% stables, up to 0.15% others',
  kyberswap: '0%, same chain only',
  cow: '0.003% stable pairs, 0.02% others, same chain only',
  debridge: '0.04% + a fixed fee in the native coin',
  near: '0.25% without a key; 0.01% stables / 0.20% others with one',
  lifi: '0.25% (jumper.xyz: none)',
  jumper: 'none — site only',
};

/** The most any service may take for itself, % of the input. */
export const FEE_CAP_PCT = 0.25;
/** NEAR's 0.0001% protocol pip rides on top of a 0.25% tier; not worth excluding over. */
const CAP_EPSILON = 0.001;
/** Within this much of the best result, the more reliable service wins. */
export const CLOSE_PCT = 0.1;
const PROVIDER_TIMEOUT_MS = 15_000;

export interface Failure {
  provider: ProviderId;
  name: string;
  reason: string;
}

export interface SearchResult {
  routes: RouteQuote[];
  failures: Failure[];
}

function failureReason(err: any): string {
  if (err?.name === 'TimeoutError') return 'timed out';
  if (err instanceof NoRoute) return err.message;
  return `error: ${err?.message ?? err}`;
}

/**
 * Asks every enabled service at once. `onProgress` fires as each one answers,
 * so a slow service holds up nothing but its own row.
 */
export async function searchRoutes(
  req: QuoteRequest,
  enabled: (id: ProviderId) => boolean,
  signal: AbortSignal,
  onProgress?: (partial: SearchResult, pending: number) => void
): Promise<SearchResult> {
  const providers = PROVIDERS.filter((p) => enabled(p.id));
  const routes: RouteQuote[] = [];
  const failures: Failure[] = [];
  let pending = providers.length;
  await Promise.all(
    providers.map(async (provider) => {
      const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
      try {
        const found = await provider.quote(req, AbortSignal.any([signal, timeout]));
        if (found.length) routes.push(...found);
        else failures.push({ provider: provider.id, name: provider.name, reason: 'no route' });
      } catch (err) {
        if (signal.aborted) return;
        failures.push({ provider: provider.id, name: provider.name, reason: failureReason(err) });
      } finally {
        pending -= 1;
        if (!signal.aborted) onProgress?.({ routes: [...routes], failures: [...failures] }, pending);
      }
    })
  );
  return { routes, failures };
}

export type Badge = 'recommended' | 'best' | 'zero-fee';

export interface RankedRoute extends RouteQuote {
  netUSD: number;
  /** Gas stood in from other routes on the same chain. */
  gasGuessed: boolean;
  overCap: boolean;
  /** Pays out clearly more than was put in — such quotes rarely execute. */
  suspicious: boolean;
  /** Loses more than 3% of the input. */
  heavyLoss: boolean;
  badges: Badge[];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function rankRoutes(routes: RouteQuote[], req: QuoteRequest, capPct = FEE_CAP_PCT) {
  const inputUSD = amountUSD(req.amount, req.fromToken);
  const typicalGas = median(routes.map((r) => r.gasUSD).filter((g): g is number => g != null && g > 0));

  const all: RankedRoute[] = routes.map((route) => {
    // One price for every route, so services quoting their own prices
    // do not tilt the order.
    const toUSD = req.toToken.priceUSD > 0 ? amountUSD(route.toAmount, req.toToken) : route.toUSD;
    const gasGuessed = route.gasUSD == null;
    const gas = route.gasUSD ?? typicalGas;
    const netUSD = toUSD - gas - route.extraUSD;
    return {
      ...route,
      toUSD,
      gasUSD: gas,
      netUSD,
      gasGuessed,
      overCap: route.serviceFeePct != null && route.serviceFeePct > capPct + CAP_EPSILON,
      suspicious: inputUSD > 0 && toUSD > inputUSD * 1.01,
      heavyLoss: inputUSD > 0 && netUSD < inputUSD * 0.97,
      badges: route.serviceFeePct === 0 && !route.estimateOnly ? ['zero-fee'] : [],
    };
  });
  all.sort((a, b) => b.netUSD - a.netUSD);

  const eligible = all.filter((r) => !r.overCap && !r.suspicious && !r.estimateOnly);
  const best = eligible[0];
  if (best) {
    best.badges.unshift('best');
    const floor = best.netUSD - Math.abs(best.netUSD) * (CLOSE_PCT / 100);
    const close = eligible.filter((r) => r.netUSD >= floor);
    const recommended = close.reduce((pick, r) => (r.reliability > pick.reliability ? r : pick), close[0]);
    recommended.badges.unshift('recommended');
  }

  return {
    inputUSD,
    ranked: all.filter((r) => !r.overCap),
    overCap: all.filter((r) => r.overCap),
  };
}

export interface OtherSite {
  name: string;
  url: string;
  note: string;
}

/** Sites worth a look that the comparison cannot quote directly. */
export function otherSites(req: QuoteRequest): OtherSite[] {
  return [
    { name: 'Rango', url: 'https://app.rango.exchange/', note: 'no fee on its own site' },
    { name: 'Jumper', url: jumperUrl(req), note: 'LI.FI without the 0.25% fee' },
  ];
}

/**
 * yearn.fi's protected Enso quote (`useProtectedEnsoQuoteState`):
 *
 * 1. Quote at 0 slippage to see what the route really returns.
 * 2. Estimate the price impact: the larger of Enso's own figure and a local
 *    one from spot USD prices of what goes in and what comes out.
 * 3. Whatever of the user's tolerance that impact leaves over becomes the
 *    route's slippage, and the route is quoted again with it. Only this
 *    second quote is ever executed.
 * 4. Refuse routes whose worst case (at `minAmountOut`) exceeds the
 *    tolerance, or reaches 5% regardless.
 */

import { EnsoRoute, fetchEnsoRoute, fetchSpotPrices } from './ensoApi';
import { ZAP_MAX_PRICE_IMPACT } from './constants';

/** How to price the route's output: vault shares (valued through the deposit
 *  asset) or a plain token. */
export type ZapOutput =
  | { kind: 'shares'; asset: string; assetDecimals: number; assetsPerShare: bigint; shareDecimals: number }
  | { kind: 'token'; token: string; decimals: number };

export interface ZapRequest {
  chainId: number;
  from: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  /** What goes in, valued in USD: deposits the input token, withdrawals the
   *  deposit asset the burned shares are worth. */
  valueIn: { token: string; decimals: number; amount: bigint };
  output: ZapOutput;
  tolerancePct: number;
}

export interface ZapQuote {
  route: EnsoRoute;
  amountIn: bigint;
  /** Percent; null when neither Enso nor prices could tell. */
  estImpact: number | null;
  worstImpact: number | null;
  /** Why this route must not be executed. */
  blocked: string | null;
}

const units = (amount: bigint, decimals: number) => Number(amount) / 10 ** decimals;

function outputUsd(output: ZapOutput, amount: bigint, prices: Record<string, number>): number | null {
  if (output.kind === 'token') {
    const price = prices[output.token.toLowerCase()];
    return price ? units(amount, output.decimals) * price : null;
  }
  const price = prices[output.asset.toLowerCase()];
  if (!price) return null;
  const assets = (amount * output.assetsPerShare) / 10n ** BigInt(output.shareDecimals);
  return units(assets, output.assetDecimals) * price;
}

const maxKnown = (...values: (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return known.length ? Math.max(...known) : null;
};

export async function quoteZap(request: ZapRequest): Promise<ZapQuote> {
  const base = {
    chainId: request.chainId,
    from: request.from,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
  };
  const outputToken = request.output.kind === 'token' ? request.output.token : request.output.asset;

  const [calibration, prices] = await Promise.all([
    fetchEnsoRoute({ ...base, slippageBps: 0 }),
    fetchSpotPrices(request.chainId, [request.valueIn.token, outputToken]).catch(() => ({})),
  ]);

  const inPrice = (prices as Record<string, number>)[request.valueIn.token.toLowerCase()];
  const usdIn = inPrice ? units(request.valueIn.amount, request.valueIn.decimals) * inPrice : null;
  const localImpact = (amountOut: bigint) => {
    const usdOut = outputUsd(request.output, amountOut, prices);
    return usdIn && usdOut !== null ? ((usdIn - usdOut) / usdIn) * 100 : null;
  };

  const enso = calibration.priceImpactPct;
  // A route paying out more than it takes in does not buy extra slippage room.
  const estimate = maxKnown(localImpact(calibration.amountOut), enso);
  const est = estimate === null ? null : Math.max(0, estimate);
  const tol = request.tolerancePct;

  if (est === null) {
    return {
      route: calibration,
      amountIn: request.amountIn,
      estImpact: null,
      worstImpact: null,
      blocked: 'Unable to estimate zap price impact.',
    };
  }
  const remaining = est >= tol ? 0 : Math.floor(((tol - est) / (100 - est)) * 100 * 100) / 100;
  if (remaining <= 0) {
    return {
      route: calibration,
      amountIn: request.amountIn,
      estImpact: est,
      worstImpact: est,
      blocked: `No protected slippage remains after the estimated ${est.toFixed(2)}% price impact.`,
    };
  }

  const route = await fetchEnsoRoute({ ...base, slippageBps: Math.floor(remaining * 100) });
  const worst = maxKnown(localImpact(route.minAmountOut), route.priceImpactPct ?? enso);
  let blocked: string | null = null;
  if (worst !== null && worst >= ZAP_MAX_PRICE_IMPACT) {
    blocked = `Price impact is too high (${worst.toFixed(2)}%).`;
  } else if (worst !== null && worst > tol) {
    blocked = `Worst-case route impact is ${worst.toFixed(2)}%, above your ${tol}% slippage.`;
  }
  return { route, amountIn: request.amountIn, estImpact: est, worstImpact: worst, blocked };
}

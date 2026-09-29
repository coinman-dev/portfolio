/**
 * Enso zap routes, wallet balances and spot prices through yearn.fi's own
 * proxies (`/api/enso/*`, `/api/prices/spot`), which hold the API keys and
 * answer with `Access-Control-Allow-Origin: *`.
 *
 * A route is plain calldata for the Enso router. It is only accepted when it
 * targets the router yearn.fi allow-lists for that chain, stays on one chain
 * and is a plain call (no delegatecall) — the same checks as `useSolverEnso`.
 */

import {
  ENSO_ROUTERS,
  NATIVE_TOKEN_ADDRESS,
  PRICE_CHAIN_SLUGS,
  WRAPPED_NATIVE,
  YEARN_API,
} from './constants';

type Hex = `0x${string}`;

export const isNativeToken = (address: string) =>
  address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();

export interface EnsoRoute {
  to: Hex;
  data: Hex;
  value: bigint;
  amountOut: bigint;
  /** What the route guarantees after its slippage allowance. */
  minAmountOut: bigint;
  /** Enso's own estimate, in percent; null when it has none. */
  priceImpactPct: number | null;
  gas: bigint;
}

export class EnsoError extends Error {}

export async function fetchEnsoConfigured(): Promise<boolean> {
  try {
    const res = await fetch(`${YEARN_API}/enso/status`);
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body?.configured);
  } catch {
    return false;
  }
}

export interface EnsoRouteRequest {
  chainId: number;
  from: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  slippageBps: number;
}

export async function fetchEnsoRoute(request: EnsoRouteRequest): Promise<EnsoRoute> {
  const query = new URLSearchParams({
    fromAddress: request.from,
    chainId: String(request.chainId),
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn.toString(),
    slippage: String(Math.max(0, Math.floor(request.slippageBps))),
    routingStrategy: 'router',
    receiver: request.from,
  });

  let res: Response;
  try {
    res = await fetch(`${YEARN_API}/enso/route?${query}`);
  } catch (err) {
    throw new EnsoError(`Could not reach the zap service: ${err instanceof Error ? err.message : err}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.tx) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message || body?.error;
    throw new EnsoError(message || `No route available (${res.status}).`);
  }

  const tx = body.tx;
  const router = ENSO_ROUTERS[request.chainId];
  if (!router || String(tx.to).toLowerCase() !== router.toLowerCase()) {
    throw new EnsoError('This approval address is not a known Enso router address.');
  }
  if (tx.chainId !== undefined && Number(tx.chainId) !== request.chainId) {
    throw new EnsoError('The route runs on another chain.');
  }
  if (tx.operationType !== undefined && Number(tx.operationType) !== 0) {
    throw new EnsoError('Unsupported route type.');
  }
  const steps: any[] = Array.isArray(body.route) ? body.route : [];
  if (steps.some((step) => String(step?.action || '').toLowerCase().includes('bridge'))) {
    throw new EnsoError('Cross-chain routes are not supported.');
  }

  const impact = Number(body.priceImpact);
  return {
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || '0'),
    amountOut: BigInt(body.amountOut),
    minAmountOut: BigInt(body.minAmountOut),
    // Enso reports basis points.
    priceImpactPct: body.priceImpact === null || body.priceImpact === undefined || !Number.isFinite(impact)
      ? null
      : impact / 100,
    gas: BigInt(body.gas || '0'),
  };
}

export interface WalletToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  /** USD per whole token; 0 when unknown. */
  price: number;
  logo?: string;
}

/** Tokens the wallet holds on one chain, worth at least a cent (the list
 *  Enso returns includes airdropped spam with no price). */
export async function fetchWalletTokens(address: string, chainId: number): Promise<WalletToken[]> {
  const res = await fetch(`${YEARN_API}/enso/balances?eoaAddress=${address}`);
  if (!res.ok) throw new EnsoError(`Wallet balances: ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) return [];
  return body
    .filter((item) => Number(item?.chainId) === chainId && item?.token)
    .map((item) => ({
      address: String(item.token),
      symbol: String(item.symbol || ''),
      name: String(item.name || item.symbol || ''),
      decimals: Number(item.decimals) || 18,
      balance: BigInt(item.amount || '0'),
      price: Number(item.price) || 0,
      logo: item.logoUri || undefined,
    }))
    .filter((token) => {
      const units = Number(token.balance) / 10 ** token.decimals;
      return token.balance > 0n && units * token.price >= 0.01;
    });
}

/** USD prices keyed by lowercase token address (native via its wrapped token). */
export async function fetchSpotPrices(chainId: number, tokens: string[]): Promise<Record<string, number>> {
  const slug = PRICE_CHAIN_SLUGS[chainId];
  if (!slug || tokens.length === 0) return {};
  const keyOf = (token: string) =>
    `${slug}:${(isNativeToken(token) ? WRAPPED_NATIVE[chainId] || token : token).toLowerCase()}`;
  const coins = [...new Set(tokens.map(keyOf))].slice(0, 50);
  const res = await fetch(`${YEARN_API}/prices/spot?coins=${encodeURIComponent(JSON.stringify(coins))}`);
  if (!res.ok) return {};
  const body = await res.json();
  const prices: Record<string, number> = {};
  for (const token of tokens) {
    const entry = body?.coins?.[keyOf(token)];
    const points: any[] = Array.isArray(entry?.prices) ? entry.prices : [];
    const price = Number(points[points.length - 1]?.price);
    if (Number.isFinite(price) && price > 0) prices[token.toLowerCase()] = price;
  }
  return prices;
}

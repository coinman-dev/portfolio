/** LI.FI's chain families; every other service is mapped onto these ids. */
export type ChainType = 'EVM' | 'SVM' | 'UTXO' | 'MVM' | 'TVM';

export interface BrChain {
  /** LI.FI chain id — the one id the whole comparison uses. */
  id: number;
  key: string;
  name: string;
  type: ChainType;
  logo?: string;
  nativeSymbol: string;
  /** How LI.FI writes this chain's native coin. */
  nativeAddress: string;
  /** Block explorer base URL, for transaction links. */
  explorer?: string;
}

export interface BrToken {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  priceUSD: number;
  /** LI.FI's check: lookalike and scam tokens are 'unverified' or 'flagged'. */
  status: 'verified' | 'unverified' | 'flagged';
  /** Shared across chains for the same asset (USDT, USDC…). */
  coinKey?: string;
}

export interface QuoteRequest {
  fromChain: BrChain;
  toChain: BrChain;
  fromToken: BrToken;
  toToken: BrToken;
  /** In `fromToken` base units. */
  amount: bigint;
  /** Sender on `fromChain`; services that accept a stand-in get one when empty. */
  fromAddress?: string;
  /** Receiver on `toChain`. */
  toAddress?: string;
  slippageBps: number;
  /** USD price of `fromChain`'s native coin, for fees charged in it. */
  fromNativePriceUSD: number;
  nearApiKey?: string;
}

export type ProviderId = 'lifi' | 'jumper' | 'socket' | 'relay' | 'kyberswap' | 'cow' | 'debridge' | 'near';

/** 3 — long-running, heavily used; 2 — established but newer or thinner; 1 — unknown. */
export type Reliability = 1 | 2 | 3;

export interface FeeLine {
  label: string;
  usd: number;
  /** Already taken out of the amount received (otherwise paid on top). */
  included: boolean;
}

export interface SiteLink {
  name: string;
  url: string;
}

export interface RouteQuote {
  id: string;
  provider: ProviderId;
  providerName: string;
  /** Bridges and DEXs the route goes through. */
  via: string;
  toAmount: bigint;
  toAmountMin?: bigint;
  toUSD: number;
  /** Network gas paid from the wallet on top; null when the service does not say. */
  gasUSD: number | null;
  /** Other costs paid on top of the input, e.g. a fixed fee in the native coin. */
  extraUSD: number;
  /** The service's own fee, % of the input; null when it does not disclose one. */
  serviceFeePct: number | null;
  serviceFeeNote?: string;
  fees: FeeLine[];
  durationSec?: number;
  reliability: Reliability;
  site: SiteLink;
  /** A figure worked out from another quote — only reachable on the site. */
  estimateOnly?: boolean;
  note?: string;
}

export interface Provider {
  id: ProviderId;
  name: string;
  quote(req: QuoteRequest, signal: AbortSignal): Promise<RouteQuote[]>;
}

/** Why a service returned nothing — shown under the list. */
export class NoRoute extends Error {}

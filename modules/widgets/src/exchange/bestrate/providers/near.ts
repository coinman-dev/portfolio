import { NoRoute, Provider, QuoteRequest } from '../types';
import { getJson, isNativeToken, receiverOf, senderOf } from './common';
import { tr } from '../i18n';
import { BCH_CHAIN_ID, DASH_CHAIN_ID, DOGE_CHAIN_ID, LTC_CHAIN_ID, XRP_CHAIN_ID, isStable } from '../catalog';

/**
 * NEAR Intents' 1Click API: solvers compete to fill; funds go to a one-time
 * deposit address. Without an API key 1Click adds up to 0.25%; with a free
 * partner key it is 0.20%, or 0.01% on stablecoin pairs.
 */
const ONE_CLICK = 'https://1click.chaindefuser.com/v0';

/** LI.FI chain id → 1Click blockchain code. */
const BLOCKCHAINS: Record<number, string> = {
  1: 'eth',
  42161: 'arb',
  8453: 'base',
  56: 'bsc',
  137: 'pol',
  10: 'op',
  43114: 'avax',
  100: 'gnosis',
  80094: 'bera',
  143: 'monad',
  196: 'xlayer',
  9745: 'plasma',
  2741: 'abs',
  534352: 'scroll',
  4663: 'hood',
  728126428: 'tron',
  1151111081099710: 'sol',
  20000000000001: 'btc',
  20000000000005: 'zec',
  [DASH_CHAIN_ID]: 'dash',
  [LTC_CHAIN_ID]: 'ltc',
  [DOGE_CHAIN_ID]: 'doge',
  [BCH_CHAIN_ID]: 'bch',
  [XRP_CHAIN_ID]: 'xrp',
  9270000000000000: 'sui',
};

let tokens: Promise<any[]> | null = null;

function oneClickTokens(): Promise<any[]> {
  tokens ??= fetch(`${ONE_CLICK}/tokens`)
    .then((res) => res.json())
    .catch((err) => {
      tokens = null;
      throw err;
    });
  return tokens;
}

async function assetOf(req: QuoteRequest, side: 'from' | 'to'): Promise<string> {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  const code = BLOCKCHAINS[chain.id];
  if (!code) throw new NoRoute(tr('{chain} is not supported', { chain: chain.name }));
  const list = await oneClickTokens();
  const native = isNativeToken(chain, token);
  const match = list.find((t) =>
    t.blockchain === code &&
    (native
      ? !t.contractAddress && t.symbol === chain.nativeSymbol
      : (t.contractAddress ?? '').toLowerCase() === token.address.toLowerCase())
  );
  if (!match) throw new NoRoute(tr('{symbol} on {chain} is not supported', { symbol: token.symbol, chain: chain.name }));
  return match.assetId;
}

export function nearFeePct(req: QuoteRequest): number {
  const protocol = 0.0001;
  if (!req.nearApiKey) return 0.25 + protocol;
  return (isStable(req.fromToken) && isStable(req.toToken) ? 0.01 : 0.2) + protocol;
}

export const nearProvider: Provider = {
  id: 'near',
  name: 'NEAR Intents',
  async quote(req, signal) {
    const [originAsset, destinationAsset] = await Promise.all([assetOf(req, 'from'), assetOf(req, 'to')]);
    const body = await getJson(`${ONE_CLICK}/quote`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(req.nearApiKey ? { 'x-api-key': req.nearApiKey } : {}),
      },
      body: JSON.stringify({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: req.slippageBps,
        originAsset,
        depositType: 'ORIGIN_CHAIN',
        destinationAsset,
        amount: req.amount.toString(),
        refundTo: senderOf(req),
        refundType: 'ORIGIN_CHAIN',
        recipient: receiverOf(req),
        recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    });
    const quote = body.quote;
    if (!quote?.amountOut) throw new NoRoute(body.message ?? 'no quote');
    const feePct = nearFeePct(req);
    return [
      {
        id: `near:${body.correlationId ?? 'quote'}`,
        provider: 'near',
        providerName: 'NEAR Intents',
        via: tr('NEAR Intents solvers'),
        toAmount: BigInt(quote.amountOut),
        toAmountMin: quote.minAmountOut ? BigInt(quote.minAmountOut) : undefined,
        toUSD: Number(quote.amountOutUsd) || 0,
        // A plain transfer to the deposit address; 1Click does not price it.
        gasUSD: null,
        extraUSD: 0,
        serviceFeePct: feePct,
        serviceFeeNote: req.nearApiKey ? undefined : 'without an API key; lower with a free partner key',
        fees: [],
        durationSec: quote.timeEstimate,
        reliability: 2,
        site: { name: 'near-intents.org', url: 'https://near-intents.org/' },
      },
    ];
  },
};

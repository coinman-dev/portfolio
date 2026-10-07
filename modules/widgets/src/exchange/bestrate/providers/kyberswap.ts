import { NoRoute, Provider, QuoteRequest } from '../types';
import { getJson, isNativeToken, sameChain } from './common';

/** KyberSwap's aggregator: swaps within one EVM chain, no fee and no key. */
const SLUGS: Record<number, string> = {
  1: 'ethereum',
  56: 'bsc',
  42161: 'arbitrum',
  8453: 'base',
  10: 'optimism',
  137: 'polygon',
  43114: 'avalanche',
  59144: 'linea',
  146: 'sonic',
  80094: 'berachain',
  130: 'unichain',
  2020: 'ronin',
  999: 'hyperevm',
  9745: 'plasma',
  143: 'monad',
  4326: 'megaeth',
  42793: 'etherlink',
};

const KYBER_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const KYBER_API = 'https://aggregator-api.kyberswap.com';

function slugOf(req: QuoteRequest): string {
  const slug = SLUGS[req.fromChain.id];
  if (!sameChain(req)) throw new NoRoute('same-chain swaps only');
  if (!slug) throw new NoRoute(`${req.fromChain.name} is not supported`);
  return slug;
}

export function kyberRoutesUrl(req: QuoteRequest): string {
  const token = (side: 'from' | 'to') => {
    const t = side === 'from' ? req.fromToken : req.toToken;
    return isNativeToken(req.fromChain, t) ? KYBER_NATIVE : t.address;
  };
  const params = new URLSearchParams({
    tokenIn: token('from'),
    tokenOut: token('to'),
    amountIn: req.amount.toString(),
  });
  return `${KYBER_API}/${slugOf(req)}/api/v1/routes?${params}`;
}

export const kyberBuildUrl = (req: QuoteRequest) => `${KYBER_API}/${slugOf(req)}/api/v1/route/build`;

export const kyberswapProvider: Provider = {
  id: 'kyberswap',
  name: 'KyberSwap',
  async quote(req, signal) {
    const slug = slugOf(req);
    const body = await getJson(kyberRoutesUrl(req), {
      signal,
      headers: { 'x-client-id': 'CoinMan' },
    });
    const summary = body.data?.routeSummary;
    if (!summary) throw new NoRoute(body.message ?? 'no route');
    return [
      {
        id: `kyberswap:${body.requestId ?? 'route'}`,
        provider: 'kyberswap',
        providerName: 'KyberSwap',
        via: 'KyberSwap',
        toAmount: BigInt(summary.amountOut),
        toUSD: Number(summary.amountOutUsd) || 0,
        gasUSD: summary.gasUsd != null ? Number(summary.gasUsd) : null,
        extraUSD: 0,
        serviceFeePct: 0,
        fees: [],
        reliability: 3,
        site: { name: 'kyberswap.com', url: `https://kyberswap.com/swap/${slug}` },
      },
    ];
  },
};

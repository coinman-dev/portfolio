import { NoRoute, Provider, QuoteRequest } from '../types';
import { tr } from '../i18n';
import { getJson, isNativeToken, sameChain } from './common';

/**
 * Mayan: cross-chain swaps between EVM chains, Solana and Sui over Wormhole
 * and Circle CCTP (Swift, MCTP). The protocol fee comes with each quote —
 * 0 on some routes, a few basis points on others — and is read from it. No
 * key; signed on swap.mayan.finance.
 */
const MAYAN_API = 'https://price-api.mayan.finance/v3';
/** The API refuses older SDK versions; this one was current on 2026-11-04. */
const SDK_VERSION = '12_0_0';
const NATIVE = '0x0000000000000000000000000000000000000000';
const SUI_COIN = '0x2::sui::SUI';

const CHAINS: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  130: 'unichain',
  137: 'polygon',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avalanche',
  59144: 'linea',
  1151111081099710: 'solana',
  9270000000000000: 'sui',
};

const tokenOf = (req: QuoteRequest, side: 'from' | 'to') => {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  if (!isNativeToken(chain, token)) return token.address;
  return chain.type === 'MVM' ? SUI_COIN : NATIVE;
};

/** A decimal amount from the API ("999.116525") in base units. */
function baseUnits(value: unknown, decimals: number): bigint {
  const [whole, fraction = ''] = String(value ?? '0').split('.');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export const mayanProvider: Provider = {
  id: 'mayan',
  name: 'Mayan',
  async quote(req, signal) {
    if (sameChain(req)) throw new NoRoute(tr('cross-chain only'));
    const fromChain = CHAINS[req.fromChain.id];
    const toChain = CHAINS[req.toChain.id];
    if (!fromChain || !toChain) {
      throw new NoRoute(tr('{chain} is not supported', { chain: fromChain ? req.toChain.name : req.fromChain.name }));
    }
    const params = new URLSearchParams({
      amountIn64: req.amount.toString(),
      fromToken: tokenOf(req, 'from'),
      fromChain,
      toToken: tokenOf(req, 'to'),
      toChain,
      slippageBps: String(req.slippageBps),
      swift: 'true',
      mctp: 'true',
      fastMctp: 'true',
      wormhole: 'true',
      sdkVersion: SDK_VERSION,
    });
    const body = await getJson(`${MAYAN_API}/quote?${params}`, { signal });
    const quotes: any[] = body.quotes ?? [];
    if (!quotes.length) throw new NoRoute(body.message ?? 'no route');
    return quotes.map((q) => ({
      id: `mayan:${q.type}`,
      provider: 'mayan' as const,
      providerName: 'Mayan',
      via: `Mayan ${String(q.type).replace(/_/g, ' ')}`,
      toAmount: baseUnits(q.expectedAmountOut, req.toToken.decimals),
      toAmountMin: q.minAmountOut != null ? baseUnits(q.minAmountOut, req.toToken.decimals) : undefined,
      toUSD: 0,
      gasUSD: null,
      extraUSD: 0,
      serviceFeePct: (Number(q.protocolBps ?? 0) + Number(q.referrerBps ?? 0)) / 100,
      fees: [],
      durationSec: Number(q.etaSeconds) || undefined,
      reliability: 2,
      site: { name: 'swap.mayan.finance', url: 'https://swap.mayan.finance/' },
    }));
  },
};

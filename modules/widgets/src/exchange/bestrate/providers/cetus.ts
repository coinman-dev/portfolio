import { NoRoute, Provider, QuoteRequest } from '../types';
import { tr } from '../i18n';
import { getJson, isNativeToken, sameChain } from './common';

/**
 * Cetus aggregator, the largest router on Sui (Cetus, DeepBook, Turbos,
 * Bluefin, Aftermath and others). No fee unless an overlay fee is set; no key.
 * Signed on app.cetus.zone.
 */
const CETUS_API = 'https://api-sui.cetus.zone/router_v2';
const SUI = 9270000000000000;
const SUI_COIN = '0x2::sui::SUI';

const coinOf = (req: QuoteRequest, side: 'from' | 'to') => {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  return isNativeToken(chain, token) ? SUI_COIN : token.address;
};

export const cetusProvider: Provider = {
  id: 'cetus',
  name: 'Cetus',
  async quote(req, signal) {
    if (req.fromChain.id !== SUI || !sameChain(req)) throw new NoRoute(tr('swaps within Sui only'));
    const from = coinOf(req, 'from');
    const target = coinOf(req, 'to');
    const params = new URLSearchParams({ from, target, amount: req.amount.toString(), by_amount_in: 'true' });
    const body = await getJson(`${CETUS_API}/find_routes?${params}`, { signal });
    const data = body.data ?? body;
    if (!data?.amount_out) throw new NoRoute(body.msg ?? 'no route');
    const toAmount = BigInt(String(data.amount_out));
    const dexes = (data.routes ?? []).flatMap((route: any) => (route.path ?? []).map((hop: any) => hop.provider));
    return [
      {
        id: 'cetus:route',
        provider: 'cetus',
        providerName: 'Cetus',
        via: [...new Set(dexes)].join(', ') || 'Cetus',
        toAmount,
        toAmountMin: (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
        toUSD: 0,
        gasUSD: null,
        extraUSD: 0,
        serviceFeePct: 0,
        fees: [],
        reliability: 2,
        site: {
          name: 'app.cetus.zone',
          url: `https://app.cetus.zone/swap/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(target)}`,
        },
      },
    ];
  },
};

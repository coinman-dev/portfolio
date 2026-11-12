import { NoRoute, Provider, QuoteRequest } from '../types';
import { tr } from '../i18n';
import { getJson, isNativeToken, sameChain } from './common';

/**
 * Jupiter's Metis swap engine, the main aggregator on Solana. Metis takes no
 * fee unless a platform fee is asked for (Jupiter Ultra does take one, so it
 * is not used). No key is needed at 0.5 requests a second. Signed on jup.ag.
 */
const JUPITER_API = 'https://lite-api.jup.ag/swap/v1';
const SOLANA = 1151111081099710;
const WSOL = 'So11111111111111111111111111111111111111112';

const mintOf = (req: QuoteRequest, side: 'from' | 'to') => {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  return isNativeToken(chain, token) ? WSOL : token.address;
};

export const jupiterProvider: Provider = {
  id: 'jupiter',
  name: 'Jupiter',
  async quote(req, signal) {
    if (req.fromChain.id !== SOLANA || !sameChain(req)) throw new NoRoute(tr('swaps within Solana only'));
    const sell = mintOf(req, 'from');
    const buy = mintOf(req, 'to');
    const params = new URLSearchParams({
      inputMint: sell,
      outputMint: buy,
      amount: req.amount.toString(),
      slippageBps: String(req.slippageBps),
    });
    const body = await getJson(`${JUPITER_API}/quote?${params}`, { signal });
    if (!body.outAmount) throw new NoRoute(body.error ?? 'no route');
    const toAmount = BigInt(body.outAmount);
    const dexes = (body.routePlan ?? []).map((step: any) => step.swapInfo?.label).filter(Boolean);
    return [
      {
        id: 'jupiter:metis',
        provider: 'jupiter',
        providerName: 'Jupiter',
        via: [...new Set(dexes)].join(' → ') || 'Jupiter',
        toAmount,
        toAmountMin: body.otherAmountThreshold ? BigInt(body.otherAmountThreshold) : undefined,
        toUSD: 0,
        gasUSD: null,
        extraUSD: 0,
        serviceFeePct: body.platformFee?.feeBps ? Number(body.platformFee.feeBps) / 100 : 0,
        fees: [],
        reliability: 3,
        site: { name: 'jup.ag', url: `https://jup.ag/swap?sell=${sell}&buy=${buy}` },
      },
    ];
  },
};

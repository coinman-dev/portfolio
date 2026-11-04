import { NoRoute, Provider, QuoteRequest } from '../types';
import { tr } from '../i18n';
import { getJson, isNativeToken, sameChain } from './common';

/**
 * Velora (formerly ParaSwap): DEX and RFQ aggregator within one EVM chain.
 * Without a partner fee it takes nothing; an anonymous caller is charged
 * 0.01%, so every call names the partner "CoinMan". When building the
 * transaction the user is set as the "partner" with a 0 fee and
 * isSurplusToUser, so positive slippage goes to the user, not to Velora.
 */
const VELORA_API = 'https://api.velora.xyz';
const VELORA_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const PARTNER = 'CoinMan';

/** Augustus v6.2: router and token-transfer proxy, the same address on every chain. */
export const VELORA_AUGUSTUS = '0x6a000f20005980200259b80c5102003040001068';

const CHAINS = new Set([1, 10, 56, 100, 130, 137, 146, 8453, 42161, 43114]);

const tokenOf = (req: QuoteRequest, side: 'from' | 'to') => {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  return isNativeToken(chain, token) ? VELORA_NATIVE : token.address;
};

export function veloraPriceUrl(req: QuoteRequest): string {
  const params = new URLSearchParams({
    srcToken: tokenOf(req, 'from'),
    destToken: tokenOf(req, 'to'),
    amount: req.amount.toString(),
    srcDecimals: String(req.fromToken.decimals),
    destDecimals: String(req.toToken.decimals),
    side: 'SELL',
    network: String(req.fromChain.id),
    version: '6.2',
    partner: PARTNER,
  });
  if (req.fromAddress) params.set('userAddress', req.fromAddress);
  return `${VELORA_API}/prices/?${params}`;
}

/** Body for POST /transactions/{chain}: no fee, any surplus to the user. */
export function veloraBuild(req: QuoteRequest, priceRoute: any) {
  return {
    url: `${VELORA_API}/transactions/${req.fromChain.id}?ignoreChecks=true`,
    body: {
      srcToken: priceRoute.srcToken,
      destToken: priceRoute.destToken,
      srcAmount: priceRoute.srcAmount,
      slippage: req.slippageBps,
      priceRoute,
      userAddress: req.fromAddress,
      receiver: req.toAddress,
      srcDecimals: req.fromToken.decimals,
      destDecimals: req.toToken.decimals,
      partner: PARTNER,
      partnerAddress: req.fromAddress,
      partnerFeeBps: '0',
      takeSurplus: true,
      isSurplusToUser: true,
    },
  };
}

export const veloraProvider: Provider = {
  id: 'velora',
  name: 'Velora',
  async quote(req, signal) {
    if (!sameChain(req)) throw new NoRoute(tr('same-chain swaps only'));
    if (!CHAINS.has(req.fromChain.id)) throw new NoRoute(tr('{chain} is not supported', { chain: req.fromChain.name }));
    const body = await getJson(veloraPriceUrl(req), { signal });
    const route = body.priceRoute;
    if (!route?.destAmount) throw new NoRoute(body.error ?? 'no route');
    const toAmount = BigInt(route.destAmount);
    const gasUSD = Number(route.gasCostUSD);
    return [
      {
        id: `velora:${route.blockNumber ?? 'quote'}`,
        provider: 'velora',
        providerName: 'Velora',
        via: 'Velora',
        toAmount,
        toAmountMin: (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
        toUSD: Number(route.destUSD) || 0,
        gasUSD: Number.isFinite(gasUSD) ? gasUSD : null,
        extraUSD: 0,
        serviceFeePct: Number(route.partnerFee ?? 0),
        serviceFeeNote: 'none; positive slippage also goes to you',
        fees: [],
        reliability: 3,
        site: { name: 'app.velora.xyz', url: 'https://app.velora.xyz/' },
      },
    ];
  },
};

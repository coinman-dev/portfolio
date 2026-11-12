import { NoRoute, Provider, QuoteRequest } from '../types';
import { tr } from '../i18n';
import { getJson, isNativeToken, sameChain } from './common';

/** SushiSwap's aggregator API v7: swaps within one EVM chain; no fee unless one is asked for. */
const SUSHI_API = 'https://api.sushi.com';
const SUSHI_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * RedSnwapper, the contract Sushi's swaps are sent to and approved for —
 * sushi-labs/sushi src/evm/config/features/red-snwapper.ts (checked 2026-11-04).
 */
const RED_SNWAPPER = '0xac4c6e212a361c968f1725b4d055b47e63f80b75';
const RED_SNWAPPER_OTHER: Record<number, string> = {
  324: '0x35e98c2b3894d71d3d4d7edb8b30e4f36e2f9179',
  4663: '0x8e6fd69a77e88ee20ba4b4fbd59dfcda3ec0e98a',
};
const CHAINS = new Set([
  1, 10, 25, 56, 100, 137, 143, 146, 250, 324, 1088, 4326, 4663, 5000, 8453, 33139, 34443, 42161, 43114, 59144,
  80094, 81457, 534352, 747474, 9745, 999, 196, 122,
]);

export const sushiRouter = (chainId: number) => RED_SNWAPPER_OTHER[chainId] ?? RED_SNWAPPER;

const tokenOf = (req: QuoteRequest, side: 'from' | 'to') => {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  return isNativeToken(chain, token) ? SUSHI_NATIVE : token.address;
};

/** /quote for prices; /swap (with sender and recipient) for the transaction. */
export function sushiUrl(req: QuoteRequest, withTx: boolean): string {
  const params = new URLSearchParams({
    tokenIn: tokenOf(req, 'from'),
    tokenOut: tokenOf(req, 'to'),
    amount: req.amount.toString(),
    maxSlippage: String(req.slippageBps / 10_000),
  });
  if (withTx) {
    params.set('sender', req.fromAddress ?? '');
    params.set('recipient', req.toAddress ?? '');
  }
  return `${SUSHI_API}/${withTx ? 'swap' : 'quote'}/v7/${req.fromChain.id}?${params}`;
}

export const sushiProvider: Provider = {
  id: 'sushi',
  name: 'SushiSwap',
  async quote(req, signal) {
    if (!sameChain(req)) throw new NoRoute(tr('same-chain swaps only'));
    if (!CHAINS.has(req.fromChain.id)) throw new NoRoute(tr('{chain} is not supported', { chain: req.fromChain.name }));
    const body = await getJson(sushiUrl(req, false), { signal });
    if (body.status !== 'Success' || !body.assumedAmountOut) throw new NoRoute(body.status ?? 'no route');
    const toAmount = BigInt(body.assumedAmountOut);
    return [
      {
        id: 'sushi:quote',
        provider: 'sushi',
        providerName: 'SushiSwap',
        via: 'Sushi aggregator',
        toAmount,
        toAmountMin: (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
        toUSD: 0,
        gasUSD: null,
        extraUSD: 0,
        serviceFeePct: 0,
        fees: [],
        reliability: 3,
        site: { name: 'sushi.com', url: `https://www.sushi.com/swap?chainId=${req.fromChain.id}` },
      },
    ];
  },
};

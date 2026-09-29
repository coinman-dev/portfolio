import { FeeLine, NoRoute, Provider, QuoteRequest, RouteQuote } from '../types';
import { amountUSD, getJson, isNativeToken, receiverOf, reliabilityOf, senderOf } from './common';

/**
 * Socket (the engine behind Bungee). The public endpoint needs no key but
 * adds its own fee — read from each route, never assumed.
 */
const SOCKET_API = 'https://public-backend.socket.tech';
const SOCKET_NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** LI.FI id → Socket id where the two differ. */
const CHAIN_IDS: Record<number, number> = {
  1151111081099710: 89999, // Solana
  20000000000001: 8253038, // Bitcoin
  9270000000000000: 1110006, // Sui
};

const chainId = (id: number) => CHAIN_IDS[id] ?? id;

function tokenOf(req: QuoteRequest, side: 'from' | 'to'): string {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  if (!isNativeToken(chain, token)) return token.address;
  if (chain.type === 'EVM' || chain.type === 'TVM') return SOCKET_NATIVE;
  throw new NoRoute(`native ${chain.nativeSymbol} is not mapped for Socket`);
}

export function socketQuoteUrl(req: QuoteRequest, user: string, receiver: string): string {
  const params = new URLSearchParams({
    originChainId: String(chainId(req.fromChain.id)),
    destinationChainId: String(chainId(req.toChain.id)),
    inputToken: tokenOf(req, 'from'),
    outputToken: tokenOf(req, 'to'),
    inputAmount: req.amount.toString(),
    userAddress: user,
    receiverAddress: receiver,
    userOps: 'tx',
    slippage: String(req.slippageBps / 100),
  });
  return `${SOCKET_API}/v3/swap/quote?${params}`;
}

export const socketProvider: Provider = {
  id: 'socket',
  name: 'Socket',
  async quote(req, signal) {
    const body = await getJson(socketQuoteUrl(req, senderOf(req), receiverOf(req)), { signal });
    if (!body.success) throw new NoRoute(body.message ?? 'no route');

    return (body.result?.routes ?? []).map((route: any, index: number): RouteQuote => {
      const details = route.routeDetails ?? {};
      const protocols = [details.dexDetails?.protocol?.displayName, details.bridgeDetails?.protocol?.displayName].filter(
        Boolean
      ) as string[];
      const fee = details.feeDetails;
      const feeUSD = fee?.feeAmount ? amountUSD(BigInt(fee.feeAmount), req.fromToken) : 0;
      const fees: FeeLine[] = fee?.feeBps ? [{ label: 'Socket fee', usd: feeUSD, included: true }] : [];
      return {
        id: `socket:${route.quoteId ?? index}`,
        provider: 'socket',
        providerName: 'Socket',
        via: protocols.join(' → ') || 'Socket',
        toAmount: BigInt(route.output.amount),
        toAmountMin: route.output.minAmountOut ? BigInt(route.output.minAmountOut) : undefined,
        toUSD: Number(route.output.valueInUsd) || 0,
        gasUSD: route.gasFee?.feeInUsd != null ? Number(route.gasFee.feeInUsd) : null,
        extraUSD: 0,
        serviceFeePct: fee?.feeBps != null ? Number(fee.feeBps) / 100 : 0,
        serviceFeeNote: fee?.feeBps ? 'public API; 0% with a Socket API key' : undefined,
        fees,
        durationSec: route.estimatedTime,
        reliability: reliabilityOf(protocols.length ? protocols : ['socket']),
        site: { name: 'bungee.exchange', url: 'https://www.bungee.exchange/' },
      };
    });
  },
};

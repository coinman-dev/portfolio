import { NoRoute, Provider } from '../types';
import { amountUSD, getJson, humanAmount, isNativeToken, receiverOf, sameChain, senderOf } from './common';

/**
 * CoW Protocol: same-chain batch auctions. The network fee comes out of the
 * sold amount, so nothing is paid on top; the protocol's volume fee
 * (0.3 bp on stable pairs, 2 bp otherwise) arrives with each quote.
 */
const NETWORKS: Record<number, string> = {
  1: 'mainnet',
  100: 'xdai',
  42161: 'arbitrum_one',
  8453: 'base',
  137: 'polygon',
  43114: 'avalanche',
  56: 'bnb',
  59144: 'linea',
  9745: 'plasma',
};

const COW_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const cowProvider: Provider = {
  id: 'cow',
  name: 'CoW Swap',
  async quote(req, signal) {
    const network = NETWORKS[req.fromChain.id];
    if (!sameChain(req)) throw new NoRoute('same-chain swaps only');
    if (!network) throw new NoRoute(`${req.fromChain.name} is not supported`);
    if (isNativeToken(req.fromChain, req.fromToken)) {
      throw new NoRoute(`selling native ${req.fromChain.nativeSymbol} needs wrapping first`);
    }
    const buyToken = isNativeToken(req.toChain, req.toToken) ? COW_NATIVE : req.toToken.address;
    const body = await getJson(`https://api.cow.fi/${network}/api/v1/quote`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sellToken: req.fromToken.address,
        buyToken,
        from: senderOf(req),
        receiver: receiverOf(req),
        kind: 'sell',
        sellAmountBeforeFee: req.amount.toString(),
        signingScheme: 'eip712',
        onchainOrder: false,
        appData: '{}',
        priceQuality: 'optimal',
      }),
    });
    const quote = body.quote;
    if (!quote?.buyAmount) throw new NoRoute('no quote');

    const toAmount = BigInt(quote.buyAmount);
    const networkFeeUSD = amountUSD(BigInt(quote.feeAmount ?? 0), req.fromToken);
    const protocolFeeBps = Number(body.protocolFeeBps ?? 0);
    const params = new URLSearchParams({ sellAmount: humanAmount(req.amount, req.fromToken.decimals) });
    return [
      {
        id: `cow:${body.id ?? 'quote'}`,
        provider: 'cow',
        providerName: 'CoW Swap',
        via: 'CoW batch auction',
        toAmount,
        toUSD: amountUSD(toAmount, req.toToken),
        // Paid out of the sold amount; the wallet sends no gas.
        gasUSD: 0,
        extraUSD: 0,
        serviceFeePct: protocolFeeBps / 100,
        fees: [{ label: 'Network fee (from the sold amount)', usd: networkFeeUSD, included: true }],
        reliability: 3,
        site: {
          name: 'swap.cow.fi',
          url: `https://swap.cow.fi/#/${req.fromChain.id}/swap/${req.fromToken.address}/${buyToken}?${params}`,
        },
      },
    ];
  },
};

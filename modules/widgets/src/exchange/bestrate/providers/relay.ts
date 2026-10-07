import { FeeLine, NoRoute, Provider, QuoteRequest } from '../types';
import { getJson, isNativeToken, receiverOf, senderOf } from './common';

const RELAY_API = 'https://api.relay.link';

/** LI.FI id → Relay id where the two differ. */
const CHAIN_IDS: Record<number, number> = {
  1151111081099710: 792703809, // Solana
  20000000000001: 8253038, // Bitcoin
};

/** Relay's own way of writing a native coin, where it differs from LI.FI's. */
const NATIVE: Record<number, string> = {
  20000000000001: 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8',
};

const chainId = (id: number) => CHAIN_IDS[id] ?? id;

function currencyOf(req: QuoteRequest, side: 'from' | 'to'): string {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  return isNativeToken(chain, token) ? (NATIVE[chain.id] ?? token.address) : token.address;
}

let chainNames: Promise<Map<number, string>> | null = null;

/** Relay's site takes the destination chain's name in the path. */
function relayChainNames(): Promise<Map<number, string>> {
  const pending =
    chainNames ??
    fetch(`${RELAY_API}/chains`)
      .then((res) => res.json())
      .then((body) => new Map<number, string>((body.chains ?? []).map((c: any) => [c.id, c.name])))
      .catch(() => {
        chainNames = null;
        return new Map<number, string>();
      });
  chainNames = pending;
  return pending;
}

export function relayRequestBody(req: QuoteRequest, user: string, recipient: string) {
  return {
    user,
    recipient,
    originChainId: chainId(req.fromChain.id),
    destinationChainId: chainId(req.toChain.id),
    originCurrency: currencyOf(req, 'from'),
    destinationCurrency: currencyOf(req, 'to'),
    amount: req.amount.toString(),
    tradeType: 'EXACT_INPUT',
    slippageTolerance: String(req.slippageBps),
  };
}

export const relayProvider: Provider = {
  id: 'relay',
  name: 'Relay',
  async quote(req, signal) {
    const body = await getJson(`${RELAY_API}/quote`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(relayRequestBody(req, senderOf(req), receiverOf(req))),
    });
    const details = body.details;
    if (!details?.currencyOut) throw new NoRoute('no route');

    const fees = body.fees ?? {};
    const usd = (key: string) => Number(fees[key]?.amountUsd) || 0;
    const inUSD = Number(details.currencyIn?.amountUsd) || 0;
    const lines: FeeLine[] = [
      { label: 'Relayer (bridge cost)', usd: usd('relayer') - usd('relayerService'), included: true },
      { label: 'Relay fee', usd: usd('relayerService'), included: true },
    ].filter((line) => line.usd > 0);

    const name = (await relayChainNames()).get(chainId(req.toChain.id));
    const siteParams = new URLSearchParams({
      fromChainId: String(chainId(req.fromChain.id)),
      fromCurrency: currencyOf(req, 'from'),
      toCurrency: currencyOf(req, 'to'),
    });
    return [
      {
        id: `relay:${body.requestId ?? 'quote'}`,
        provider: 'relay',
        providerName: 'Relay',
        via: 'Relay',
        toAmount: BigInt(details.currencyOut.amount),
        toAmountMin: details.currencyOut.minimumAmount ? BigInt(details.currencyOut.minimumAmount) : undefined,
        toUSD: Number(details.currencyOut.amountUsd) || 0,
        gasUSD: fees.gas ? usd('gas') : null,
        extraUSD: 0,
        serviceFeePct: inUSD > 0 ? (usd('relayerService') / inUSD) * 100 : null,
        fees: lines,
        durationSec: details.timeEstimate,
        reliability: 3,
        site: {
          name: 'relay.link',
          url: name ? `https://relay.link/bridge/${name}?${siteParams}` : 'https://relay.link/',
        },
      },
    ];
  },
};

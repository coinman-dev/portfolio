import { BrChain, BrToken, ChainType, NoRoute, QuoteRequest, Reliability } from '../types';
import { addressKey } from '../format';
import { tr } from '../i18n';

/**
 * Stand-in addresses for quotes before the user's own are known. Execution
 * and deposits never use them: they take `fromAddress`/`toAddress` only.
 * Tron and the UTXO chains get the all-zero key hash, which nobody holds a
 * key for; Solana and Sui still need a real address.
 */
const STAND_IN: Partial<Record<ChainType, string>> = {
  EVM: '0x000000000000000000000000000000000000dEaD',
  TVM: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
};
const UTXO_STAND_IN: Record<string, string> = {
  btc: '1111111111111111111114oLvT2',
  dash: 'XagqqFetxiDb9wbartKDrXgnqLah6SqX2S',
  zec: 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs',
  ltc: 'LKDxGDJq5fF4FohAB8zJH24mDDNHDNtqsE',
  doge: 'D596YFweJQuHY1BbjazZYmAbt8jJPbKehC',
  bch: '1111111111111111111114oLvT2',
};

const standIn = (chain: BrChain) => (chain.type === 'UTXO' ? UTXO_STAND_IN[chain.key] : STAND_IN[chain.type]);

export function senderOf(req: QuoteRequest): string {
  const address = req.fromAddress || standIn(req.fromChain);
  if (!address) throw new NoRoute(tr('needs a {chain} sender address', { chain: req.fromChain.name }));
  return address;
}

export function receiverOf(req: QuoteRequest): string {
  // The sender's address doubles as the receiver only where the format is
  // shared (any EVM chain); Bitcoin and Dash are both UTXO but differ.
  const sameFormat = addressKey(req.fromChain) === addressKey(req.toChain);
  const address = req.toAddress || (sameFormat ? req.fromAddress : undefined) || standIn(req.toChain);
  if (!address) throw new NoRoute(tr('needs a {chain} receiver address', { chain: req.toChain.name }));
  return address;
}

export const toUnits = (amount: bigint, decimals: number) => Number(amount) / 10 ** decimals;

export const amountUSD = (amount: bigint, token: BrToken) => toUnits(amount, token.decimals) * token.priceUSD;

/** Plain decimal string for site links: 1000.5 rather than 1.0005e3. */
export function humanAmount(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Bridges and DEXs with a long record and heavy volume. */
const PROVEN = [
  'across', 'stargate', 'cctp', 'circle', 'relay', 'debridge', 'dln', 'cow', 'kyber', '1inch',
  '0x', 'paraswap', 'velora', 'odos', 'openocean', 'uniswap', 'sushi', 'curve', 'balancer',
  'canonical', 'native bridge', 'arbitrum bridge', 'optimism bridge', 'polygon bridge',
];

/** Established, but newer, solver-based or with thinner liquidity. */
const KNOWN = [
  'symbiosis', 'mayan', 'near', 'layerswap', 'glacis', 'eco', 'gaszip', 'gas.zip', 'orbiter',
  'allbridge', 'chainflip', 'thorchain', 'squid', 'hop', 'cbridge', 'celer', 'meson', 'owlto',
  'nordstern', 'fynd', 'hashflow', 'bebop', 'lifi', 'li.fi', 'okx', 'bitget', 'dodo',
];

export function reliabilityOf(toolNames: string[]): Reliability {
  let worst: Reliability = 3;
  for (const raw of toolNames) {
    const name = raw.toLowerCase();
    const tier: Reliability = PROVEN.some((p) => name.includes(p))
      ? 3
      : KNOWN.some((p) => name.includes(p))
        ? 2
        : 1;
    if (tier < worst) worst = tier;
  }
  return worst;
}

export async function getJson(url: string, init: RequestInit & { signal: AbortSignal }): Promise<any> {
  const res = await fetch(url, init);
  if (res.status === 429) throw new NoRoute('too many requests right now — try Refresh in a minute');
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${res.status}: ${text.slice(0, 80)}`);
  }
  if (!res.ok) {
    const message = body?.message ?? body?.error ?? body?.errorMessage ?? text.slice(0, 120);
    throw new NoRoute(typeof message === 'string' ? message : JSON.stringify(message).slice(0, 120));
  }
  return body;
}

export const sameChain = (req: QuoteRequest) => req.fromChain.id === req.toChain.id;

export const isNativeToken = (chain: BrChain, token: BrToken) =>
  token.address.toLowerCase() === chain.nativeAddress.toLowerCase();

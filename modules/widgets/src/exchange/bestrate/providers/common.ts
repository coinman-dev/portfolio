import { BrChain, BrToken, ChainType, NoRoute, QuoteRequest, Reliability } from '../types';

/**
 * Stand-in sender for quotes before a wallet is connected. Only EVM has one
 * that every service accepts; the other families need a real address.
 */
const STAND_IN: Partial<Record<ChainType, string>> = {
  EVM: '0x000000000000000000000000000000000000dEaD',
};

export function senderOf(req: QuoteRequest): string {
  const address = req.fromAddress || STAND_IN[req.fromChain.type];
  if (!address) throw new NoRoute(`needs a ${req.fromChain.name} sender address`);
  return address;
}

export function receiverOf(req: QuoteRequest): string {
  const sameFamily = req.fromChain.type === req.toChain.type;
  const address = req.toAddress || (sameFamily ? req.fromAddress : undefined) || STAND_IN[req.toChain.type];
  if (!address) throw new NoRoute(`needs a ${req.toChain.name} receiver address`);
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

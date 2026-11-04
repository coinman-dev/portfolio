import { BrChain, BrToken, FeeLine, NoRoute, Provider, QuoteRequest, RouteQuote } from '../types';
import { amountUSD, getJson, isNativeToken, receiverOf, toUnits } from './common';
import { DASH_CHAIN_ID } from '../catalog';
import { tr } from '../i18n';

/**
 * Maya Protocol: native-asset pools (no bridges, no wrapped tokens), vaults
 * signed jointly by the node set. The quote API is free and needs no key, and
 * without an affiliate in the memo there is no interface fee — only the pool's
 * liquidity fee and the outbound gas, both already out of the amount quoted.
 * Large swaps stream: sub-swaps one per block, so arbitrage refills the pool
 * between them.
 */
const MAYANODE = 'https://mayanode.mayachain.info/mayachain';
/** Pool depths and vault balances move with every swap; a minute is fresh enough to warn. */
const STATE_TTL_MS = 60_000;
/** Above this share of a pool's depth a swap leans on arbitrage refilling it. */
const DEEP_SHARE = 0.5;
/** OP_RETURN carries at most 80 bytes; MAYAChain itself allows 250. */
const UTXO_MEMO_LIMIT = 80;
const MEMO_LIMIT = 250;
/** A typical one-input, three-output (vault, memo, change) UTXO transaction. */
const UTXO_TX_BYTES = 250;

/** Maya chain code → LI.FI chain id. */
const CHAIN_IDS: Record<string, number> = {
  ETH: 1,
  ARB: 42161,
  BTC: 20000000000001,
  ZEC: 20000000000005,
  DASH: DASH_CHAIN_ID,
};
const CODES = Object.fromEntries(Object.entries(CHAIN_IDS).map(([code, id]) => [id, code]));

/** Chains a deposit is sent to by hand, with the memo in OP_RETURN. */
export const isMayaDepositChain = (chain: BrChain) => chain.type === 'UTXO' && chain.id in CODES;

interface Pool {
  /** e.g. `ETH.USDT-0XDAC1…` */
  asset: string;
  /** The asset side of the pool, 1e8 units. */
  depth: bigint;
}

type Cached<T> = { at: number; promise: Promise<T> } | null;

function cached<T>(slot: { value: Cached<T> }, load: () => Promise<T>): Promise<T> {
  if (slot.value && Date.now() - slot.value.at < STATE_TTL_MS) return slot.value.promise;
  const promise = load();
  slot.value = { at: Date.now(), promise };
  promise.catch(() => {
    if (slot.value?.promise === promise) slot.value = null;
  });
  return promise;
}

const poolsSlot: { value: Cached<Pool[]> } = { value: null };
const vaultsSlot: { value: Cached<any[]> } = { value: null };

/** Pools open for swaps. */
function availablePools(signal: AbortSignal): Promise<Pool[]> {
  return cached(poolsSlot, () =>
    getJson(`${MAYANODE}/pools`, { signal }).then((list: any[]) =>
      list
        .filter((p) => p.status === 'Available')
        .map((p) => ({ asset: String(p.asset), depth: BigInt(String(p.balance_asset ?? 0)) }))
    )
  );
}

/** What Maya's vaults hold of an asset right now — the most one payout can take from them. */
async function vaultHoldings(asset: string, signal: AbortSignal): Promise<bigint> {
  const vaults = await cached(vaultsSlot, () => getJson(`${MAYANODE}/vaults/asgard`, { signal }));
  let held = 0n;
  for (const vault of vaults) {
    if (vault.status !== 'ActiveVault' && vault.status !== 'RetiringVault') continue;
    for (const coin of vault.coins ?? []) if (coin.asset === asset) held += BigInt(String(coin.amount ?? 0));
  }
  return held;
}

const units = (amount: bigint) => toUnits(amount, 8).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * Whether the pools and vaults can carry this size. A quote assumes arbitrage
 * refills the pools between sub-swaps; when it does not, the parts that miss
 * the limit come back as a refund — no loss, but only part of the swap done.
 */
async function capacityWarning(req: QuoteRequest, q: any, signal: AbortSignal): Promise<string | undefined> {
  const [list, held] = await Promise.all([availablePools(signal), vaultHoldings(q.toAsset, signal)]);
  const amountIn = toMaya(req.amount, req.fromToken.decimals);
  const amountOut = BigInt(String(q.expected_amount_out));
  if (held > 0n && amountOut > held) {
    return tr(
      "Maya's vaults hold only {held} {symbol} on {chain}, less than this payout: it completes only as arbitrage refills them, and whatever does not fill is refunded. Split it into smaller swaps over time.",
      { held: units(held), symbol: req.toToken.symbol, chain: req.toChain.name }
    );
  }
  const depth = (asset: string) => list.find((p) => p.asset === asset)?.depth ?? 0n;
  const share = (amount: bigint, pool: bigint) => (pool > 0n ? Number((amount * 1000n) / pool) / 1000 : 0);
  const worst = Math.max(share(amountIn, depth(q.fromAsset)), share(amountOut, depth(q.toAsset)));
  if (worst > DEEP_SHARE) {
    return tr(
      "Large for Maya's pools ({pct}% of a pool's depth): the swap relies on arbitrage between sub-swaps, so parts may be refunded. Smaller swaps are safer.",
      { pct: Math.round(worst * 100) }
    );
  }
  return undefined;
}

async function assetOf(chain: BrChain, token: BrToken, signal: AbortSignal): Promise<string> {
  const code = CODES[chain.id];
  if (!code) throw new NoRoute(tr('{chain} is not supported', { chain: chain.name }));
  const list = (await availablePools(signal)).map((p) => p.asset).filter((asset) => asset.startsWith(`${code}.`));
  const match = isNativeToken(chain, token)
    ? list.find((asset) => !asset.includes('-'))
    : list.find((asset) => asset.toLowerCase().endsWith(`-${token.address.toLowerCase()}`));
  if (!match) throw new NoRoute(tr('{symbol} on {chain} has no open pool', { symbol: token.symbol, chain: chain.name }));
  return match;
}

/** MAYAChain counts every asset in 1e8 units. */
const toMaya = (amount: bigint, decimals: number) =>
  decimals >= 8 ? amount / 10n ** BigInt(decimals - 8) : amount * 10n ** BigInt(8 - decimals);
const fromMaya = (amount: bigint, decimals: number) =>
  decimals >= 8 ? amount * 10n ** BigInt(decimals - 8) : amount / 10n ** BigInt(8 - decimals);

const reason = (error: string) => error.replace(/^failed to simulate swap: /, '');

async function fetchQuote(req: QuoteRequest, streaming: boolean, signal: AbortSignal): Promise<any> {
  const [fromAsset, toAsset] = await Promise.all([
    assetOf(req.fromChain, req.fromToken, signal),
    assetOf(req.toChain, req.toToken, signal),
  ]);
  const params = new URLSearchParams({
    from_asset: fromAsset,
    to_asset: toAsset,
    amount: toMaya(req.amount, req.fromToken.decimals).toString(),
    destination: receiverOf(req),
  });
  // Interval 1 and quantity 0: a sub-swap every block, as many as the
  // network finds best.
  if (streaming) {
    params.set('streaming_interval', '1');
    params.set('streaming_quantity', '0');
  }
  const body = await getJson(`${MAYANODE}/quote/swap?${params}`, { signal });
  if (body.error) throw new NoRoute(reason(String(body.error)));
  if (!body.expected_amount_out || !body.memo || !body.inbound_address) throw new NoRoute('incomplete quote');
  return { ...body, fromAsset, toAsset };
}

function toRoute(req: QuoteRequest, q: any, streaming: boolean, warning?: string): RouteQuote {
  const out = (value: unknown) => fromMaya(BigInt(String(value ?? 0)), req.toToken.decimals);
  const toAmount = out(q.expected_amount_out);
  const fees: FeeLine[] = [
    { label: 'Pool liquidity fee', usd: amountUSD(out(q.fees?.liquidity), req.toToken), included: true },
    { label: 'Outbound network fee', usd: amountUSD(out(q.fees?.outbound), req.toToken), included: true },
  ];
  const affiliate = Number(q.fees?.affiliate ?? 0);
  // A hand-sent UTXO deposit pays its own miner fee at the recommended rate.
  const gasUSD = isMayaDepositChain(req.fromChain)
    ? toUnits(BigInt(Number(q.recommended_gas_rate ?? 0) * UTXO_TX_BYTES), 8) * req.fromNativePriceUSD
    : null;
  const parts = Number(q.max_streaming_quantity ?? 0);
  const minutes = Math.max(1, Math.round(Number(q.total_swap_seconds ?? 0) / 60));
  return {
    id: `maya:${streaming ? 'stream' : 'single'}`,
    provider: 'maya',
    providerName: streaming ? tr('Maya Protocol · stream') : 'Maya Protocol',
    via: streaming ? tr('Maya pools, {count} sub-swaps', { count: parts }) : tr('Maya pools'),
    toAmount,
    toAmountMin: (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
    toUSD: amountUSD(toAmount, req.toToken),
    gasUSD,
    extraUSD: 0,
    serviceFeePct: affiliate > 0 ? (affiliate / Number(q.expected_amount_out)) * 100 : 0,
    serviceFeeNote: 'no interface fee; the pool fee and outbound gas are already out of the amount',
    fees,
    durationSec: Number(q.total_swap_seconds) || undefined,
    reliability: 2,
    site: { name: 'NativeSwap', url: 'https://app.nativeswap.io/swap' },
    note: streaming
      ? tr('Streams {count} sub-swaps over about {minutes} min; any part that cannot fill within your slippage is refunded.', {
          count: parts,
          minutes,
        })
      : 'One swap at once: large amounts lose more to pool slippage than a stream.',
    maya: { streaming },
    capacityWarning: warning,
  };
}

export const mayaProvider: Provider = {
  id: 'maya',
  name: 'Maya Protocol',
  async quote(req, signal) {
    const [single, stream] = await Promise.allSettled([
      fetchQuote(req, false, signal),
      fetchQuote(req, true, signal),
    ]);
    const routes: RouteQuote[] = [];
    // Only a stream can fill partly; a single swap's loss is already in its price.
    const warn = (q: any) => capacityWarning(req, q, signal).catch(() => undefined);
    if (single.status === 'fulfilled') routes.push(toRoute(req, single.value, false));
    // A one-part stream is the single swap again, only slower.
    if (stream.status === 'fulfilled' && Number(stream.value.max_streaming_quantity) > 1) {
      routes.push(toRoute(req, stream.value, true, await warn(stream.value)));
    }
    if (!routes.length) {
      const failed = [single, stream].find((r): r is PromiseRejectedResult => r.status === 'rejected');
      throw failed?.reason ?? new NoRoute('no quote');
    }
    return routes;
  },
};

/** 1e8-unit limit in MAYAChain's short form, rounded down: 2267259966600 → 22672e8. */
export function shortLimit(limit: bigint): string {
  const digits = limit.toString();
  if (digits.length <= 7) return digits;
  return `${digits.slice(0, 5)}e${digits.length - 5}`;
}

/** The limit Maya will read from the memo: 22672e8 → 2267200000000. */
export function expandLimit(short: string): bigint {
  const [mantissa, exponent] = short.split('e');
  return BigInt(mantissa) * 10n ** BigInt(exponent ?? 0);
}

export const memoHex = (memo: string) =>
  [...new TextEncoder().encode(memo)].map((b) => b.toString(16).padStart(2, '0')).join('');

export interface MayaDeposit {
  /** Maya's vault on the source chain — valid for this quote only. */
  vault: string;
  memo: string;
  memoHex: string;
  /** Exactly what to send, in the source token's base units. */
  amount: bigint;
  expectedOut: bigint;
  minOut: bigint;
  /** Unix seconds; do not send after it. */
  expiry: number;
  /** Fee rate the vault expects, e.g. 12 satsperbyte. */
  gasRate: number;
  gasRateUnits: string;
  durationSec: number;
  streamingParts: number;
  /** Set when the pools or vaults are thin for this size. */
  capacityWarning?: string;
}

/**
 * A fresh quote turned into deposit instructions, checked on every point a
 * mistake would lose money: the vault is the one Maya publishes now and not
 * halted, the memo pays the receiver, carries a real price limit instead of
 * the API's 0 and fits in OP_RETURN.
 */
export async function mayaDeposit(req: QuoteRequest, streaming: boolean, signal: AbortSignal): Promise<MayaDeposit> {
  const code = CODES[req.fromChain.id];
  if (!code) throw new Error(tr('{chain} is not a Maya deposit chain', { chain: req.fromChain.name }));
  // Quotes may run on a stand-in receiver; a deposit memo never may.
  const receiver = req.toAddress;
  if (!receiver) throw new Error(tr('Enter your {chain} receiver address first', { chain: req.toChain.name }));
  const [q, inbound] = await Promise.all([
    fetchQuote(req, streaming, signal),
    getJson(`${MAYANODE}/inbound_addresses`, { signal }),
  ]);

  const vault = (inbound as any[]).find((entry) => entry.chain === code);
  if (!vault) throw new Error(tr('Maya publishes no {chain} vault right now', { chain: req.fromChain.name }));
  if (vault.halted) throw new Error(tr('Maya has halted {chain} — do not send anything now', { chain: req.fromChain.name }));
  if (vault.address !== q.inbound_address) {
    throw new Error(tr('The quote names a different vault than Maya publishes — try again in a minute'));
  }

  const amount1e8 = toMaya(req.amount, req.fromToken.decimals);
  const minIn = BigInt(String(q.recommended_min_amount_in ?? 0));
  const dust = BigInt(String(vault.dust_threshold ?? 0));
  if (amount1e8 < minIn || amount1e8 <= dust) {
    throw new Error(
      tr("The amount is below Maya's minimum for this swap ({amount} {symbol})", {
        amount: toUnits(minIn > dust ? minIn : dust, 8),
        symbol: req.fromToken.symbol,
      })
    );
  }

  const parts = String(q.memo).split(':');
  const sameReceiver =
    req.toChain.type === 'EVM' ? parts[2]?.toLowerCase() === receiver.toLowerCase() : parts[2] === receiver;
  // `=:ASSET:DEST` for a single swap, `=:ASSET:DEST:0/1/0` for a stream.
  if (!['=', 's', 'swap'].includes(parts[0]?.toLowerCase()) || !sameReceiver || parts.length < 3 || parts.length > 4) {
    throw new Error(tr('Unexpected memo from Maya ({memo}) — not sending', { memo: q.memo }));
  }
  const expected = BigInt(String(q.expected_amount_out));
  const limit = shortLimit((expected * BigInt(10_000 - req.slippageBps)) / 10_000n);
  const [, interval, quantity] = (parts[3] ?? '').split('/');
  parts[3] = interval ? [limit, interval, quantity ?? '0'].join('/') : limit;
  const memo = parts.join(':');
  const bytes = new TextEncoder().encode(memo).length;
  if (bytes > (req.fromChain.type === 'UTXO' ? UTXO_MEMO_LIMIT : MEMO_LIMIT)) {
    throw new Error(tr('The memo is {bytes} bytes, more than the chain can carry', { bytes }));
  }

  return {
    vault: vault.address,
    memo,
    memoHex: memoHex(memo),
    amount: req.amount,
    expectedOut: fromMaya(expected, req.toToken.decimals),
    minOut: fromMaya(expandLimit(limit), req.toToken.decimals),
    expiry: Number(q.expiry) || 0,
    gasRate: Number(q.recommended_gas_rate ?? vault.gas_rate) || 0,
    gasRateUnits: String(q.gas_rate_units ?? vault.gas_rate_units ?? ''),
    durationSec: Number(q.total_swap_seconds) || 0,
    streamingParts: Number(q.max_streaming_quantity) || 1,
    capacityWarning: streaming ? await capacityWarning(req, q, signal).catch(() => undefined) : undefined,
  };
}

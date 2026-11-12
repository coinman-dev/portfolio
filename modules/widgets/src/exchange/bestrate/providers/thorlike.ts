import { BrChain, BrToken, FeeLine, NoRoute, Provider, QuoteRequest, Reliability, RouteQuote, SiteLink } from '../types';
import { amountUSD, isNativeToken, receiverOf, toUnits } from './common';
import { BCH_CHAIN_ID, DASH_CHAIN_ID, DOGE_CHAIN_ID, LTC_CHAIN_ID, XRP_CHAIN_ID } from '../catalog';
import { intlLocale, subSwaps, tr } from '../i18n';

/**
 * Maya Protocol and THORChain: native-asset pools (no bridges, no wrapped
 * tokens) with vaults signed jointly by the node set. Maya is a THORChain fork
 * with the same API and memos, so one implementation serves both. The quote
 * API is free and needs no key, and without an affiliate in the memo there is
 * no interface fee — only the pool's liquidity fee and the outbound gas, both
 * already out of the amount quoted. Large swaps stream: sub-swaps one per
 * block, so arbitrage refills the pool between them.
 */
export type ThorLikeId = 'maya' | 'thorchain';

export interface ThorLikeConfig {
  id: ThorLikeId;
  name: string;
  /** Node API bases, tried in order when one is down. */
  nodes: string[];
  /** Chain code → LI.FI chain id. */
  chainIds: Record<string, number>;
  /**
   * The router on each EVM chain, as the network publishes it in
   * inbound_addresses (checked 2026-11-04). A quote naming another router is
   * refused: after an upgrade this list has to be updated first.
   */
  routers: Record<number, string>;
  site: SiteLink;
  tracker: { name: string; tx: (hash: string) => string };
  reliability: Reliability;
}

export const MAYA: ThorLikeConfig = {
  id: 'maya',
  name: 'Maya Protocol',
  nodes: ['https://mayanode.mayachain.info/mayachain', 'https://api-maya.liquify.com/mayachain'],
  chainIds: { ETH: 1, ARB: 42161, BTC: 20000000000001, ZEC: 20000000000005, DASH: DASH_CHAIN_ID },
  routers: {
    1: '0xe3985e6b61b814f7cdb188766562ba71b446b46d',
    42161: '0x700e97ef07219440487840dc472e7120a7ff11f4',
  },
  site: { name: 'NativeSwap', url: 'https://app.nativeswap.io/swap' },
  tracker: { name: 'MayaScan', tx: (hash) => `https://www.mayascan.org/tx/${hash}` },
  reliability: 2,
};

export const THORCHAIN: ThorLikeConfig = {
  id: 'thorchain',
  name: 'THORChain',
  nodes: [
    'https://gateway.liquify.com/chain/thorchain_api/thorchain',
    'https://thorchain-thornode-lb-1.thorwallet.org/thorchain',
  ],
  chainIds: {
    ETH: 1,
    BASE: 8453,
    BSC: 56,
    AVAX: 43114,
    BTC: 20000000000001,
    ZEC: 20000000000005,
    LTC: LTC_CHAIN_ID,
    DOGE: DOGE_CHAIN_ID,
    BCH: BCH_CHAIN_ID,
    XRP: XRP_CHAIN_ID,
    SOL: 1151111081099710,
    TRON: 728126428,
  },
  routers: {
    1: '0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146',
    8453: '0x00dc6100103bc402d490aee3f9a5560cbd91f1d4',
    43114: '0x00dc6100103bc402d490aee3f9a5560cbd91f1d4',
    56: '0xb30ec53f98ff5947ede720d32ac2da7e52a5f56b',
  },
  site: { name: 'swap.thorchain.org', url: 'https://swap.thorchain.org/' },
  tracker: { name: 'thorchain.net', tx: (hash) => `https://thorchain.net/tx/${hash}` },
  reliability: 2,
};

export const thorlikeConfig = (id: string): ThorLikeConfig | undefined =>
  id === 'maya' ? MAYA : id === 'thorchain' ? THORCHAIN : undefined;

/** Pool depths and vault balances move with every swap; a minute is fresh enough to warn. */
const STATE_TTL_MS = 60_000;
/** Above this share of a pool's depth a swap leans on arbitrage refilling it. */
const DEEP_SHARE = 0.5;
/** OP_RETURN carries at most 80 bytes; the networks themselves allow 250. */
const UTXO_MEMO_LIMIT = 80;
const MEMO_LIMIT = 250;
/** A typical one-input, three-output (vault, memo, change) UTXO transaction. */
const UTXO_TX_BYTES = 250;

const codeOf = (cfg: ThorLikeConfig, chain: BrChain) =>
  Object.entries(cfg.chainIds).find(([, id]) => id === chain.id)?.[0];

/** Chains a deposit is sent to by hand: UTXO with the memo in OP_RETURN, XRP with it in MemoData. */
export const isDepositChain = (cfg: ThorLikeConfig, chain: BrChain) =>
  (chain.type === 'UTXO' || chain.type === 'XRPL') && codeOf(cfg, chain) !== undefined;

const reason = (error: string) => error.replace(/^failed to simulate swap: /, '');

/** GET from the first node that answers; a refusal (4xx) is final, an outage tries the next. */
async function nodeJson(cfg: ThorLikeConfig, path: string, signal: AbortSignal): Promise<any> {
  let lastError: unknown = new Error(`${cfg.name}: no node answered`);
  for (const node of cfg.nodes) {
    try {
      const res = await fetch(`${node}${path}`, { signal });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`${cfg.name}: ${res.status}`);
        continue;
      }
      const body = await res.json();
      if (!res.ok) throw new NoRoute(reason(String(body?.message ?? body?.error ?? res.status)));
      return body;
    } catch (err) {
      if (err instanceof NoRoute || signal.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

interface Pool {
  /** e.g. `ETH.USDT-0XDAC1…` */
  asset: string;
  /** The asset side of the pool, 1e8 units. */
  depth: bigint;
}

type Cached<T> = { at: number; promise: Promise<T> };
const cache = new Map<string, Cached<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.promise;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/** Pools open for swaps. */
function availablePools(cfg: ThorLikeConfig, signal: AbortSignal): Promise<Pool[]> {
  return cached(`${cfg.id}:pools`, () =>
    nodeJson(cfg, '/pools', signal).then((list: any[]) =>
      list
        .filter((p) => p.status === 'Available')
        .map((p) => ({ asset: String(p.asset), depth: BigInt(String(p.balance_asset ?? 0)) }))
    )
  );
}

/** What the vaults hold of an asset right now — the most one payout can take from them. */
async function vaultHoldings(cfg: ThorLikeConfig, asset: string, signal: AbortSignal): Promise<bigint> {
  const vaults = await cached<any[]>(`${cfg.id}:vaults`, () => nodeJson(cfg, '/vaults/asgard', signal));
  let held = 0n;
  for (const vault of vaults) {
    if (vault.status !== 'ActiveVault' && vault.status !== 'RetiringVault') continue;
    for (const coin of vault.coins ?? []) if (coin.asset === asset) held += BigInt(String(coin.amount ?? 0));
  }
  return held;
}

const units = (amount: bigint) => toUnits(amount, 8).toLocaleString(intlLocale(), { maximumFractionDigits: 2 });

/** Why a stream may fill only partly, and how much the tight side holds ("193,718 USDT"). */
export interface Capacity {
  text: string;
  available: string;
}

/**
 * Whether the pools and vaults can carry this size. A quote assumes arbitrage
 * refills the pools between sub-swaps; when it does not, the parts that miss
 * the limit come back as a refund — no loss, but only part of the swap done.
 */
async function capacityWarning(cfg: ThorLikeConfig, req: QuoteRequest, q: any, signal: AbortSignal): Promise<Capacity | undefined> {
  const [list, held] = await Promise.all([availablePools(cfg, signal), vaultHoldings(cfg, q.toAsset, signal)]);
  const amountIn = toUnits1e8(req.amount, req.fromToken.decimals);
  const amountOut = BigInt(String(q.expected_amount_out));
  if (held > 0n && amountOut > held) {
    const available = tr('in vaults: {amount}', { amount: `${units(held)} ${req.toToken.symbol}` });
    return {
      available,
      text: tr(
        "{provider}'s vaults hold only {held} {symbol} on {chain}, less than this payout: it completes only as arbitrage refills them, and whatever does not fill is refunded. Split it into smaller swaps over time.",
        { provider: cfg.name, held: units(held), symbol: req.toToken.symbol, chain: req.toChain.name }
      ),
    };
  }
  const depth = (asset: string) => list.find((p) => p.asset === asset)?.depth ?? 0n;
  const share = (amount: bigint, pool: bigint) => (pool > 0n ? Number((amount * 1000n) / pool) / 1000 : 0);
  const inShare = share(amountIn, depth(q.fromAsset));
  const outShare = share(amountOut, depth(q.toAsset));
  const worst = Math.max(inShare, outShare);
  if (worst > DEEP_SHARE) {
    // The pool that limits the swap, in its own coin, and the swap's share of it.
    const [pool, symbol] =
      inShare >= outShare ? [depth(q.fromAsset), req.fromToken.symbol] : [depth(q.toAsset), req.toToken.symbol];
    const available = tr('{symbol} pool: {amount}, this swap is {pct}% of it', {
      symbol,
      amount: `${units(pool)} ${symbol}`,
      pct: Math.round(worst * 100),
    });
    return {
      available,
      text: tr(
        "{provider}'s {symbol} pool holds only {amount}, and this swap is {pct}% of it. The network splits it into parts and relies on arbitrage to bring the price back between them; whatever cannot fill within your price limit is refunded in the coin you sent. Smaller swaps are safer.",
        { provider: cfg.name, symbol, amount: `${units(pool)} ${symbol}`, pct: Math.round(worst * 100) }
      ),
    };
  }
  return undefined;
}

async function assetOf(cfg: ThorLikeConfig, chain: BrChain, token: BrToken, signal: AbortSignal): Promise<string> {
  const code = codeOf(cfg, chain);
  if (!code) throw new NoRoute(tr('{chain} is not supported', { chain: chain.name }));
  const list = (await availablePools(cfg, signal)).map((p) => p.asset).filter((asset) => asset.startsWith(`${code}.`));
  const match = isNativeToken(chain, token)
    ? list.find((asset) => !asset.includes('-'))
    : list.find((asset) => asset.toLowerCase().endsWith(`-${token.address.toLowerCase()}`));
  if (!match) throw new NoRoute(tr('{symbol} on {chain} has no open pool', { symbol: token.symbol, chain: chain.name }));
  return match;
}

/** Both networks count every asset in 1e8 units. */
const toUnits1e8 = (amount: bigint, decimals: number) =>
  decimals >= 8 ? amount / 10n ** BigInt(decimals - 8) : amount * 10n ** BigInt(8 - decimals);
const from1e8 = (amount: bigint, decimals: number) =>
  decimals >= 8 ? amount * 10n ** BigInt(decimals - 8) : amount / 10n ** BigInt(8 - decimals);

async function fetchQuote(cfg: ThorLikeConfig, req: QuoteRequest, streaming: boolean, signal: AbortSignal): Promise<any> {
  const [fromAsset, toAsset] = await Promise.all([
    assetOf(cfg, req.fromChain, req.fromToken, signal),
    assetOf(cfg, req.toChain, req.toToken, signal),
  ]);
  const params = new URLSearchParams({
    from_asset: fromAsset,
    to_asset: toAsset,
    amount: toUnits1e8(req.amount, req.fromToken.decimals).toString(),
    destination: receiverOf(req),
  });
  // Interval 1 and quantity 0: a sub-swap every block, as many as the
  // network finds best.
  if (streaming) {
    params.set('streaming_interval', '1');
    params.set('streaming_quantity', '0');
  }
  const body = await nodeJson(cfg, `/quote/swap?${params}`, signal);
  if (body.error) throw new NoRoute(reason(String(body.error)));
  if (!body.expected_amount_out || !body.memo || !body.inbound_address) throw new NoRoute('incomplete quote');
  return { ...body, fromAsset, toAsset };
}

function toRoute(cfg: ThorLikeConfig, req: QuoteRequest, q: any, streaming: boolean, warning?: Capacity): RouteQuote {
  const out = (value: unknown) => from1e8(BigInt(String(value ?? 0)), req.toToken.decimals);
  const toAmount = out(q.expected_amount_out);
  const fees: FeeLine[] = [
    { label: 'Pool liquidity fee', usd: amountUSD(out(q.fees?.liquidity), req.toToken), included: true },
    { label: 'Outbound network fee', usd: amountUSD(out(q.fees?.outbound), req.toToken), included: true },
  ];
  const affiliate = Number(q.fees?.affiliate ?? 0);
  // A hand-sent deposit pays its own network fee at the recommended rate:
  // per byte on UTXO chains, a flat fee in drops on XRP.
  const rate = Number(q.recommended_gas_rate ?? 0);
  const gasUSD = !isDepositChain(cfg, req.fromChain)
    ? null
    : req.fromChain.type === 'XRPL'
      ? (rate / 1e6) * req.fromNativePriceUSD
      : toUnits(BigInt(rate * UTXO_TX_BYTES), 8) * req.fromNativePriceUSD;
  const parts = Number(q.max_streaming_quantity ?? 0);
  const minutes = Math.max(1, Math.round(Number(q.total_swap_seconds ?? 0) / 60));
  return {
    id: `${cfg.id}:${streaming ? 'stream' : 'single'}`,
    provider: cfg.id,
    providerName: streaming ? `${cfg.name} · ${tr('stream')}` : cfg.name,
    via: streaming
      ? tr('{provider} pools, {parts}', { provider: cfg.name, parts: subSwaps(parts) })
      : tr('{provider} pools', { provider: cfg.name }),
    toAmount,
    toAmountMin: (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
    toUSD: amountUSD(toAmount, req.toToken),
    gasUSD,
    extraUSD: 0,
    serviceFeePct: affiliate > 0 ? (affiliate / Number(q.expected_amount_out)) * 100 : 0,
    serviceFeeNote: 'no interface fee; the pool fee and outbound gas are already out of the amount',
    fees,
    durationSec: Number(q.total_swap_seconds) || undefined,
    reliability: cfg.reliability,
    site: cfg.site,
    note: req.toChain.type === 'XRPL'
      ? 'The receiving XRP address must already be activated (hold the 1 XRP reserve); send to your own wallet, not to an exchange address that needs a destination tag.'
      : streaming
      ? tr('Streams {parts} over about {minutes} min; any part that cannot fill within your slippage is refunded.', {
          parts: subSwaps(parts),
          minutes,
        })
      : // THORChain splits even this quote into a few sub-swaps within one block.
        parts > 1
        ? undefined
        : 'One swap at once: large amounts lose more to pool slippage than a stream.',
    thorlike: { streaming },
    capacityWarning: warning?.text,
    capacityAvailable: warning?.available,
  };
}

export function thorlikeProvider(cfg: ThorLikeConfig): Provider {
  return {
    id: cfg.id,
    name: cfg.name,
    async quote(req, signal) {
      const [single, stream] = await Promise.allSettled([
        fetchQuote(cfg, req, false, signal),
        fetchQuote(cfg, req, true, signal),
      ]);
      const routes: RouteQuote[] = [];
      // Only a stream can fill partly; a single swap's loss is already in its price.
      const warn = (q: any) => capacityWarning(cfg, req, q, signal).catch(() => undefined);
      if (single.status === 'fulfilled') routes.push(toRoute(cfg, req, single.value, false));
      // A one-part stream is the single swap again, only slower.
      if (stream.status === 'fulfilled' && Number(stream.value.max_streaming_quantity) > 1) {
        routes.push(toRoute(cfg, req, stream.value, true, await warn(stream.value)));
      }
      if (!routes.length) {
        const failed = [single, stream].find((r): r is PromiseRejectedResult => r.status === 'rejected');
        throw failed?.reason ?? new NoRoute('no quote');
      }
      return routes;
    },
  };
}

export const mayaProvider = thorlikeProvider(MAYA);
export const thorchainProvider = thorlikeProvider(THORCHAIN);

/** 1e8-unit limit in the networks' short form, rounded down: 2267259966600 → 22672e8. */
export function shortLimit(limit: bigint): string {
  const digits = limit.toString();
  if (digits.length <= 7) return digits;
  return `${digits.slice(0, 5)}e${digits.length - 5}`;
}

/** The limit the network will read from the memo: 22672e8 → 2267200000000. */
export function expandLimit(short: string): bigint {
  const [mantissa, exponent] = short.split('e');
  return BigInt(mantissa) * 10n ** BigInt(exponent ?? 0);
}

export const memoHex = (memo: string) =>
  [...new TextEncoder().encode(memo)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A chain is usable when its vault exists and neither it nor its trading is halted. */
const isOpen = (entry: any) => !!entry && !entry.halted && !entry.chain_trading_paused && !entry.global_trading_paused;

/**
 * Addresses of the network's active vaults on one chain, read fresh. Several
 * vaults are active at once and the recommended one changes, so a quote may
 * name another active vault than inbound_addresses does a moment later.
 */
async function activeVaults(cfg: ThorLikeConfig, code: string, signal: AbortSignal): Promise<Set<string>> {
  const vaults: any[] = await nodeJson(cfg, '/vaults/asgard', signal);
  const found = new Set<string>();
  for (const vault of vaults) {
    if (vault.status !== 'ActiveVault') continue;
    for (const entry of vault.addresses ?? []) if (entry.chain === code) found.add(String(entry.address).toLowerCase());
  }
  return found;
}

interface CheckedSend {
  q: any;
  /** The source chain's inbound_addresses entry: halt flags, gas rate, router. */
  vault: any;
  /** Where to send: the quote's vault, checked to be one of the network's active vaults. */
  vaultAddress: string;
  memo: string;
  expectedOut: bigint;
  minOut: bigint;
}

/**
 * A fresh quote, checked on every point a mistake would lose money: both
 * chains open, the vault the one the network publishes now, the amount above
 * its minimum, the memo paying the receiver with a real price limit instead of
 * the API's 0, and short enough for the chain to carry.
 */
async function checkedSend(cfg: ThorLikeConfig, req: QuoteRequest, streaming: boolean, signal: AbortSignal): Promise<CheckedSend> {
  const code = codeOf(cfg, req.fromChain);
  const toCode = codeOf(cfg, req.toChain);
  if (!code || !toCode) throw new Error(tr('{chain} is not supported', { chain: req.fromChain.name }));
  // Quotes may run on a stand-in receiver; a real send never may.
  const receiver = req.toAddress;
  if (!receiver) throw new Error(tr('Enter your {chain} receiver address first', { chain: req.toChain.name }));
  const [q, inbound] = await Promise.all([
    fetchQuote(cfg, req, streaming, signal),
    nodeJson(cfg, '/inbound_addresses', signal) as Promise<any[]>,
  ]);

  const vault = inbound.find((entry) => entry.chain === code);
  if (!vault) {
    throw new Error(tr('{provider} publishes no {chain} vault right now', { provider: cfg.name, chain: req.fromChain.name }));
  }
  if (!isOpen(vault)) {
    throw new Error(tr('{provider} has halted {chain} — do not send anything now', { provider: cfg.name, chain: req.fromChain.name }));
  }
  // Payouts on the network's own chain (MAYA, THOR) have no inbound entry to check.
  const payout = inbound.find((entry) => entry.chain === toCode);
  if (payout && !isOpen(payout)) {
    throw new Error(tr('{provider} has halted {chain}, where the payout goes — try later', { provider: cfg.name, chain: req.toChain.name }));
  }
  const quoted = String(q.inbound_address);
  if (quoted.toLowerCase() !== String(vault.address).toLowerCase() && !(await activeVaults(cfg, code, signal)).has(quoted.toLowerCase())) {
    throw new Error(tr('The quote names a different vault than {provider} publishes — try again in a minute', { provider: cfg.name }));
  }

  const amount1e8 = toUnits1e8(req.amount, req.fromToken.decimals);
  const minIn = BigInt(String(q.recommended_min_amount_in ?? 0));
  const dust = BigInt(String(vault.dust_threshold ?? 0));
  if (amount1e8 < minIn || amount1e8 <= dust) {
    throw new Error(
      tr("The amount is below {provider}'s minimum for this swap ({amount} {symbol})", {
        provider: cfg.name,
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
    throw new Error(tr('Unexpected memo from {provider} ({memo}) — not sending', { provider: cfg.name, memo: q.memo }));
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
    q,
    vault,
    vaultAddress: quoted,
    memo,
    expectedOut: from1e8(expected, req.toToken.decimals),
    minOut: from1e8(expandLimit(limit), req.toToken.decimals),
  };
}

export interface ThorLikeDeposit {
  /** The network's vault on the source chain — valid for this quote only. */
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
  capacityWarning?: Capacity;
}

/** Instructions for a deposit sent by hand from a UTXO wallet, memo in OP_RETURN. */
export async function thorlikeDeposit(
  cfg: ThorLikeConfig,
  req: QuoteRequest,
  streaming: boolean,
  signal: AbortSignal
): Promise<ThorLikeDeposit> {
  if (!isDepositChain(cfg, req.fromChain)) {
    throw new Error(tr('{chain} is not a {provider} deposit chain', { chain: req.fromChain.name, provider: cfg.name }));
  }
  const { q, vault, vaultAddress, memo, expectedOut, minOut } = await checkedSend(cfg, req, streaming, signal);
  return {
    vault: vaultAddress,
    memo,
    memoHex: memoHex(memo),
    amount: req.amount,
    expectedOut,
    minOut,
    expiry: Number(q.expiry) || 0,
    gasRate: Number(q.recommended_gas_rate ?? vault.gas_rate) || 0,
    gasRateUnits: String(q.gas_rate_units ?? vault.gas_rate_units ?? ''),
    durationSec: Number(q.total_swap_seconds) || 0,
    streamingParts: Number(q.max_streaming_quantity) || 1,
    capacityWarning: streaming ? await capacityWarning(cfg, req, q, signal).catch(() => undefined) : undefined,
  };
}

export interface ThorLikeEvmSend {
  router: `0x${string}`;
  vault: `0x${string}`;
  memo: string;
  /** Unix seconds; the router refuses the deposit after it. */
  expiry: bigint;
  expectedOut: bigint;
  minOut: bigint;
}

/**
 * The deposit from an EVM wallet: `router.depositWithExpiry(vault, asset,
 * amount, memo, expiry)`. The router must be the one in the quote, in
 * inbound_addresses and in this file's list — all three the same.
 */
export async function thorlikeEvmSend(
  cfg: ThorLikeConfig,
  req: QuoteRequest,
  streaming: boolean,
  signal: AbortSignal
): Promise<ThorLikeEvmSend> {
  const known = cfg.routers[req.fromChain.id];
  if (req.fromChain.type !== 'EVM' || !known) {
    throw new NoRoute(tr('{provider} has no router listed here for {chain}', { provider: cfg.name, chain: req.fromChain.name }));
  }
  const { q, vault, vaultAddress, memo, expectedOut, minOut } = await checkedSend(cfg, req, streaming, signal);
  const quoted = String(q.router ?? '').toLowerCase();
  const published = String(vault.router ?? '').toLowerCase();
  if (quoted !== known || published !== known) {
    throw new NoRoute(
      tr('{provider} named router {address}, not the one on its published list — not sending', {
        provider: cfg.name,
        address: q.router ?? vault.router ?? '?',
      })
    );
  }
  const expiry = BigInt(Number(q.expiry) || 0);
  if (expiry <= BigInt(Math.floor(Date.now() / 1000) + 60)) throw new NoRoute(tr('the quote is about to expire — try again'));
  return { router: known as `0x${string}`, vault: vaultAddress as `0x${string}`, memo, expiry, expectedOut, minOut };
}

/** Where a deposit stands, from the network's own tx status. */
export async function thorlikeTxStatus(
  cfg: ThorLikeConfig,
  hash: string,
  signal: AbortSignal
): Promise<{ state: 'pending' | 'done' | 'refunded' | 'failed'; detail?: string }> {
  const id = hash.replace(/^0x/i, '').toUpperCase();
  const body = await nodeJson(cfg, `/tx/status/${id}`, signal);
  const stages = body.stages ?? {};
  const outs: any[] = body.out_txs ?? [];
  const refunds = outs.filter((tx) => /^REFUND/i.test(String(tx.memo ?? ''))).length;
  const paid = outs.length - refunds;
  const planned: any[] = body.planned_out_txs ?? [];
  const signed = stages.outbound_signed ? stages.outbound_signed.completed === true : true;
  // Done once every planned payout (or refund) has gone out; the stages are
  // missing for some transactions, so they only hold it back when present.
  if (outs.length && outs.length >= planned.length && signed && !stages.swap_status?.pending) {
    if (!paid) return { state: 'refunded' };
    return { state: 'done', detail: refunds ? tr('part was refunded') : undefined };
  }
  if (!stages.inbound_observed?.completed) return { state: 'pending', detail: tr('waiting for the network to see the deposit') };
  if (stages.swap_status?.pending) return { state: 'pending', detail: tr('swapping') };
  return { state: 'pending', detail: tr('sending the payout') };
}

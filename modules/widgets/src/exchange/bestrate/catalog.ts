import { BrChain, BrToken, ChainType } from './types';

/**
 * Chains and tokens come from LI.FI's public lists: free to read, they cover
 * every family (EVM, Solana, Bitcoin, Sui, Tron) and carry USD prices.
 */
const LIFI_API = 'https://li.quest/v1';
const CACHE_MS = 10 * 60_000;

/**
 * Dash is not on LI.FI; Maya Protocol and NEAR Intents swap it. Its id is our
 * own, from a range LI.FI leaves unused (its UTXO chains are 20000000000001…).
 */
export const DASH_CHAIN_ID = 30000000000001;
const DASH_LOGO = 'https://assets.coingecko.com/coins/images/19/standard/dash-logo.png';
const DASH_CHAIN: BrChain = {
  id: DASH_CHAIN_ID,
  key: 'dash',
  name: 'Dash',
  type: 'UTXO',
  logo: DASH_LOGO,
  nativeSymbol: 'DASH',
  nativeAddress: 'dash',
  explorer: 'https://insight.dash.org/insight',
};

/** Shown first, in this order; the rest follow by name. */
const POPULAR = [1, 42161, 8453, 56, 10, 137, 43114, 728126428, 1151111081099710, 20000000000001, DASH_CHAIN_ID];

let chainsCache: { at: number; promise: Promise<BrChain[]> } | null = null;

export function fetchChains(): Promise<BrChain[]> {
  if (chainsCache && Date.now() - chainsCache.at < CACHE_MS) return chainsCache.promise;
  const promise = fetch(`${LIFI_API}/chains?chainTypes=EVM,SVM,UTXO,MVM,TVM`)
    .then((res) => {
      if (!res.ok) throw new Error(`chains: ${res.status}`);
      return res.json();
    })
    .then((body) => {
      const chains: BrChain[] = (body.chains ?? [])
        .filter((c: any) => c.mainnet !== false)
        .map((c: any) => ({
          id: c.id,
          key: c.key,
          name: c.name,
          type: c.chainType as ChainType,
          logo: c.logoURI,
          nativeSymbol: c.nativeToken?.symbol ?? c.coin,
          nativeAddress: c.nativeToken?.address ?? '0x0000000000000000000000000000000000000000',
          explorer: String(c.metamask?.blockExplorerUrls?.[0] ?? '').replace(/\/+$/, '') || undefined,
        }));
      if (!chains.some((c) => c.id === DASH_CHAIN_ID)) chains.push(DASH_CHAIN);
      const rank = (id: number) => {
        const i = POPULAR.indexOf(id);
        return i === -1 ? POPULAR.length : i;
      };
      return chains.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
    });
  chainsCache = { at: Date.now(), promise };
  promise.catch(() => {
    if (chainsCache?.promise === promise) chainsCache = null;
  });
  return promise;
}

const tokensCache = new Map<number, { at: number; promise: Promise<BrToken[]> }>();

function toToken(t: any): BrToken {
  return {
    chainId: t.chainId,
    address: t.address,
    symbol: t.symbol,
    name: t.name ?? t.symbol,
    decimals: t.decimals,
    logo: t.logoURI,
    priceUSD: Number(t.priceUSD) || 0,
    status: t.verificationStatus === 'verified' ? 'verified' : t.verificationStatus === 'flagged' ? 'flagged' : 'unverified',
    coinKey: t.coinKey,
  };
}

/**
 * A chain's own coin has no contract to fake, so LI.FI's verification (made
 * for lookalike tokens) does not apply to it — e.g. ZEC comes back unverified.
 */
function withNativeTrust(token: BrToken, chain?: BrChain): BrToken {
  if (!chain || token.address.toLowerCase() !== chain.nativeAddress.toLowerCase()) return token;
  return { ...token, status: 'verified' };
}

/** Listed first, in this order, when present and verified. */
const MAJOR_COINS = ['USDT', 'USDC', 'DAI', 'USDS', 'WETH', 'WBTC', 'CBBTC', 'USDE', 'WBNB', 'WPOL', 'WAVAX'];

function tokenRank(token: BrToken, chain?: BrChain): number {
  if (chain && token.address.toLowerCase() === chain.nativeAddress.toLowerCase()) return 0;
  if (token.status !== 'verified') return token.status === 'flagged' ? 4000 : 3000;
  const major = MAJOR_COINS.indexOf((token.coinKey ?? '').toUpperCase());
  return major === -1 ? 2000 : 1 + major;
}

/** Native coin, then majors, then other verified tokens; lookalikes last. */
export function sortTokens(tokens: BrToken[], chain?: BrChain): BrToken[] {
  return [...tokens].sort((a, b) => tokenRank(a, chain) - tokenRank(b, chain) || a.symbol.localeCompare(b.symbol));
}

/**
 * A second opinion for tokens LI.FI leaves unverified: CoinGecko's token list
 * for the chain. A token counts as checked when CoinGecko lists that very
 * contract under the same symbol — a fake "USDT" has a different address, so
 * it stays unverified. Flagged tokens are left as they are.
 */
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const COINGECKO_LISTS = 'https://tokens.coingecko.com';
const COINGECKO_TIMEOUT_MS = 6_000;
/** Non-EVM chains CoinGecko's platform list gives no chain id for. */
const COINGECKO_PLATFORMS: Record<number, string> = {
  728126428: 'tron',
  1151111081099710: 'solana',
  9270000000000000: 'sui',
};

let platforms: Promise<Map<number, string>> | null = null;

function coingeckoPlatform(chainId: number): Promise<string | undefined> {
  if (COINGECKO_PLATFORMS[chainId]) return Promise.resolve(COINGECKO_PLATFORMS[chainId]);
  platforms ??= fetch(`${COINGECKO_API}/asset_platforms`, { signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS) })
    .then((res) => res.json())
    .then((list: any[]) => new Map(list.filter((p) => p.chain_identifier).map((p) => [Number(p.chain_identifier), String(p.id)])))
    .catch((err) => {
      platforms = null;
      throw err;
    });
  return platforms.then((map) => map.get(chainId));
}

/** EVM addresses compare in any case; base58 ones (Tron, Solana) as written. */
const listKey = (chain: BrChain | undefined, address: string, symbol: string) =>
  `${chain?.type === 'EVM' ? address.toLowerCase() : address}|${symbol.toUpperCase()}`;

const coingeckoLists = new Map<number, Promise<Set<string>>>();

function coingeckoListed(chain: BrChain): Promise<Set<string>> {
  let hit = coingeckoLists.get(chain.id);
  if (!hit) {
    hit = coingeckoPlatform(chain.id)
      .then((platform) => {
        if (!platform) return new Set<string>();
        return fetch(`${COINGECKO_LISTS}/${platform}/all.json`, { signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS) })
          .then((res) => (res.ok ? res.json() : { tokens: [] }))
          .then((body) => new Set<string>((body.tokens ?? []).map((t: any) => listKey(chain, String(t.address), String(t.symbol)))));
      })
      .catch(() => {
        // Try again next time; until then nothing gets upgraded.
        coingeckoLists.delete(chain.id);
        return new Set<string>();
      });
    coingeckoLists.set(chain.id, hit);
  }
  return hit;
}

async function confirmByCoinGecko(tokens: BrToken[], chain?: BrChain): Promise<BrToken[]> {
  if (!chain || !tokens.some((t) => t.status === 'unverified')) return tokens;
  const listed = await coingeckoListed(chain);
  if (!listed.size) return tokens;
  return tokens.map((t) =>
    t.status === 'unverified' && listed.has(listKey(chain, t.address, t.symbol)) ? { ...t, status: 'verified' } : t
  );
}

/** DASH's USD price: CoinGecko, or Maya's pool price when CoinGecko is unavailable. */
async function dashPrice(): Promise<number> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=dash&vs_currencies=usd');
    const price = Number((await res.json())?.dash?.usd);
    if (price > 0) return price;
  } catch {
    /* fall through to Maya */
  }
  const res = await fetch('https://midgard.mayachain.info/v2/pool/DASH.DASH');
  return Number((await res.json())?.assetPriceUSD) || 0;
}

async function dashTokens(): Promise<BrToken[]> {
  return [
    {
      chainId: DASH_CHAIN_ID,
      address: DASH_CHAIN.nativeAddress,
      symbol: 'DASH',
      name: 'Dash',
      decimals: 8,
      logo: DASH_LOGO,
      priceUSD: await dashPrice().catch(() => 0),
      status: 'verified',
      coinKey: 'DASH',
    },
  ];
}

export function fetchTokens(chainId: number): Promise<BrToken[]> {
  const hit = tokensCache.get(chainId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = chainId === DASH_CHAIN_ID ? dashTokens() : Promise.all([
    fetch(`${LIFI_API}/tokens?chains=${chainId}`).then((res) => {
      if (!res.ok) throw new Error(`tokens: ${res.status}`);
      return res.json();
    }),
    fetchChains().catch(() => [] as BrChain[]),
  ]).then(async ([body, chains]) => {
    const chain = chains.find((c) => c.id === chainId);
    const tokens = ((body.tokens?.[chainId] ?? []) as any[]).map((t) => withNativeTrust(toToken(t), chain));
    return sortTokens(await confirmByCoinGecko(tokens, chain), chain);
  });
  tokensCache.set(chainId, { at: Date.now(), promise });
  promise.catch(() => {
    if (tokensCache.get(chainId)?.promise === promise) tokensCache.delete(chainId);
  });
  return promise;
}

/** One token by address — for pasted addresses and fresh prices. */
export async function fetchToken(chainId: number, address: string): Promise<BrToken | null> {
  if (chainId === DASH_CHAIN_ID) {
    return (await fetchTokens(chainId)).find((t) => t.address === address.trim().toLowerCase()) ?? null;
  }
  const res = await fetch(`${LIFI_API}/token?chain=${chainId}&token=${encodeURIComponent(address)}`);
  if (!res.ok) return null;
  const chain = (await fetchChains().catch(() => [] as BrChain[])).find((c) => c.id === chainId);
  const [token] = await confirmByCoinGecko([withNativeTrust(toToken(await res.json()), chain)], chain);
  return token;
}

export const isNative = (chain: BrChain, token: BrToken) =>
  token.address.toLowerCase() === chain.nativeAddress.toLowerCase();

const STABLES = new Set([
  'USDC', 'USDT', 'DAI', 'USDS', 'USDE', 'FRAX', 'LUSD', 'BOLD', 'PYUSD', 'USDC.E', 'USDT0',
  'GHO', 'CRVUSD', 'USD1', 'FDUSD', 'TUSD', 'USDBC', 'SUSD', 'DOLA', 'USDB',
]);

export const isStable = (token: BrToken) => STABLES.has(token.symbol.toUpperCase());

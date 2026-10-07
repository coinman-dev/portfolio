import { BrChain, BrToken, ChainType } from './types';

/**
 * Chains and tokens come from LI.FI's public lists: free to read, they cover
 * every family (EVM, Solana, Bitcoin, Sui, Tron) and carry USD prices.
 */
const LIFI_API = 'https://li.quest/v1';
const CACHE_MS = 10 * 60_000;

/** Shown first, in this order; the rest follow by name. */
const POPULAR = [1, 42161, 8453, 56, 10, 137, 43114, 728126428, 1151111081099710, 20000000000001];

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

export function fetchTokens(chainId: number): Promise<BrToken[]> {
  const hit = tokensCache.get(chainId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = Promise.all([
    fetch(`${LIFI_API}/tokens?chains=${chainId}`).then((res) => {
      if (!res.ok) throw new Error(`tokens: ${res.status}`);
      return res.json();
    }),
    fetchChains().catch(() => [] as BrChain[]),
  ]).then(([body, chains]) =>
    sortTokens(((body.tokens?.[chainId] ?? []) as any[]).map(toToken), chains.find((c) => c.id === chainId))
  );
  tokensCache.set(chainId, { at: Date.now(), promise });
  promise.catch(() => {
    if (tokensCache.get(chainId)?.promise === promise) tokensCache.delete(chainId);
  });
  return promise;
}

/** One token by address — for pasted addresses and fresh prices. */
export async function fetchToken(chainId: number, address: string): Promise<BrToken | null> {
  const res = await fetch(`${LIFI_API}/token?chain=${chainId}&token=${encodeURIComponent(address)}`);
  if (!res.ok) return null;
  return toToken(await res.json());
}

export const isNative = (chain: BrChain, token: BrToken) =>
  token.address.toLowerCase() === chain.nativeAddress.toLowerCase();

const STABLES = new Set([
  'USDC', 'USDT', 'DAI', 'USDS', 'USDE', 'FRAX', 'LUSD', 'BOLD', 'PYUSD', 'USDC.E', 'USDT0',
  'GHO', 'CRVUSD', 'USD1', 'FDUSD', 'TUSD', 'USDBC', 'SUSD', 'DOLA', 'USDB',
]);

export const isStable = (token: BrToken) => STABLES.has(token.symbol.toUpperCase());

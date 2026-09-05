import { YearnVault, SupportedChain } from './types';

export const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    id: 1,
    name: 'Ethereum',
    shortName: 'ETH',
    icon: 'https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/chains/1/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
  },
  {
    id: 42161,
    name: 'Arbitrum',
    shortName: 'ARB',
    icon: 'https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/chains/42161/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
  },
  {
    id: 8453,
    name: 'Base',
    shortName: 'BASE',
    icon: 'https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/chains/8453/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
  },
  {
    id: 10,
    name: 'Optimism',
    shortName: 'OP',
    icon: 'https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/chains/10/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
  },
  {
    id: 137,
    name: 'Polygon',
    shortName: 'POL',
    icon: 'https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/chains/137/logo-128.png',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
  },
];

const vaultCache: Record<number, { data: YearnVault[]; timestamp: number }> = {};
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

export async function fetchYearnVaults(chainId: number): Promise<YearnVault[]> {
  const cached = vaultCache[chainId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://ydaemon.yearn.fi/${chainId}/vaults/all`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`yDaemon request failed with status: ${res.status}`);
    }

    const rawVaults: any[] = await res.json();
    if (!Array.isArray(rawVaults)) {
      return [];
    }

    // Filter active, production vaults with TVL > 0 or endorsed
    const filtered: YearnVault[] = rawVaults
      .filter((v) => {
        if (!v || !v.address || !v.token) return false;
        if (v.details?.isRetired || v.details?.isHidden) return false;
        if (v.emergency_shutdown) return false;
        // Check TVL or active version
        const tvl = Number(v.tvl?.tvl || 0);
        return tvl > 100 || v.endorsed;
      })
      .map((v) => {
        const netAPR =
          v.apr?.netAPR !== null && v.apr?.netAPR !== undefined
            ? Number(v.apr.netAPR)
            : v.apr?.forwardAPR?.netAPR !== null && v.apr?.forwardAPR?.netAPR !== undefined
            ? Number(v.apr.forwardAPR.netAPR)
            : 0;

        return {
          address: v.address,
          type: v.type || 'Yearn Vault',
          kind: v.kind,
          symbol: v.symbol || v.displaySymbol || 'yVault',
          displaySymbol: v.displaySymbol || v.symbol,
          name: v.displayName || v.name || 'Yearn Vault',
          displayName: v.displayName || v.name,
          icon: v.icon || v.token?.icon,
          version: v.version || '3.0.0',
          category: v.category || v.details?.category || 'General',
          chainID: chainId,
          endorsed: !!v.endorsed,
          boosted: !!v.boosted,
          emergency_shutdown: !!v.emergency_shutdown,
          token: {
            address: v.token.address,
            name: v.token.name || v.token.symbol || 'Token',
            symbol: v.token.symbol || 'TOKEN',
            decimals: v.token.decimals || 18,
            icon: v.token.icon,
            description: v.token.description,
          },
          tvl: {
            totalAssets: v.tvl?.totalAssets,
            tvl: Number(v.tvl?.tvl || 0),
            price: Number(v.tvl?.price || 1),
          },
          apr: {
            type: v.apr?.type,
            netAPR,
            fees: v.apr?.fees,
          },
          details: v.details,
        };
      });

    // Sort by TVL descending initially
    filtered.sort((a, b) => (b.tvl.tvl || 0) - (a.tvl.tvl || 0));

    vaultCache[chainId] = {
      data: filtered,
      timestamp: Date.now(),
    };

    return filtered;
  } catch (err) {
    console.error(`[YearnApi] Error loading vaults for chain ${chainId}:`, err);
    return [];
  }
}

export async function fetchAllChainsVaults(): Promise<YearnVault[]> {
  const promises = SUPPORTED_CHAINS.map((c) => fetchYearnVaults(c.id));
  const results = await Promise.allSettled(promises);

  const all: YearnVault[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      all.push(...r.value);
    }
  }

  all.sort((a, b) => (b.tvl.tvl || 0) - (a.tvl.tvl || 0));
  return all;
}

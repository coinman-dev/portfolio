import { YearnVault, SupportedChain } from './types';

export const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    id: 1,
    name: 'Ethereum',
    shortName: 'eth',
    icon: 'https://assets.smold.app/api/token/1/0x0000000000000000000000000000000000000000/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
  },
  {
    id: 42161,
    name: 'Arbitrum',
    shortName: 'arb',
    icon: 'https://assets.smold.app/api/token/42161/0x0000000000000000000000000000000000000000/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
  },
  {
    id: 8453,
    name: 'Base',
    shortName: 'base',
    icon: 'https://assets.smold.app/api/token/8453/0x0000000000000000000000000000000000000000/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
  },
  {
    id: 10,
    name: 'Optimism',
    shortName: 'opt',
    icon: 'https://assets.smold.app/api/token/10/0x0000000000000000000000000000000000000000/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
  },
  {
    id: 137,
    name: 'Polygon',
    shortName: 'pol',
    icon: 'https://assets.smold.app/api/token/137/0x0000000000000000000000000000000000000000/logo-128.png',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
  },
];

export function getChain(chainId: number): SupportedChain {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId) || SUPPORTED_CHAINS[0];
}

const YDAEMON_BASE_URL = 'https://ydaemon.yearn.fi';

/**
 * Fetch all production vaults for a specific chain from Yearn's yDaemon
 */
export async function fetchYearnVaults(chainId: number): Promise<YearnVault[]> {
  try {
    // Note: yDaemon defaults to limit=200 without query param, which truncates active vaults.
    // Specifying limit=2500 ensures all production vaults (including BOLD, newer v3 vaults) are fetched.
    const url = `${YDAEMON_BASE_URL}/${chainId}/vaults/all?limit=2500`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch Yearn vaults: ${res.statusText}`);
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
        // Check TVL or endorsed
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

    return filtered;
  } catch (err) {
    console.error(`[YearnApi] Error fetching vaults for chain ${chainId}:`, err);
    return [];
  }
}

/**
 * Fetch vaults across all supported chains concurrently
 */
export async function fetchAllChainsVaults(): Promise<YearnVault[]> {
  const promises = SUPPORTED_CHAINS.map((c) => fetchYearnVaults(c.id));
  const results = await Promise.all(promises);
  return results.flat();
}

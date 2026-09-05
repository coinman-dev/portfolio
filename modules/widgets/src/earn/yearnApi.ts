import { YearnVault, SupportedChain } from './types';

export const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    id: 1,
    name: 'Ethereum',
    shortName: 'eth',
    icon: 'https://assets.smold.app/api/token/1/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
  },
  {
    id: 10,
    name: 'Optimism',
    shortName: 'opt',
    icon: 'https://assets.smold.app/api/token/10/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
  },
  {
    id: 8453,
    name: 'Base',
    shortName: 'base',
    icon: 'https://assets.smold.app/api/token/8453/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
  },
  {
    id: 42161,
    name: 'Arbitrum',
    shortName: 'arb',
    icon: 'https://assets.smold.app/api/token/42161/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/logo-128.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
  },
  {
    id: 137,
    name: 'Polygon',
    shortName: 'pol',
    icon: 'https://assets.smold.app/api/token/137/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/logo-128.png',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
  },
];

export function getChain(chainId: number): SupportedChain {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId) || SUPPORTED_CHAINS[0];
}

const YDAEMON_BASE_URL = 'https://ydaemon.yearn.fi';

// Canonical yBOLD and Staked yBOLD contract addresses on Ethereum
const YBOLD_VAULT_ADDRESS = '0x9F4330700a36B29952869fac9b33f45EEdd8A3d8'.toLowerCase();
const YBOLD_STAKING_ADDRESS = '0x23346B04a7f55b8760E5860AA5A77383D63491cD'.toLowerCase();

/**
 * Fetch all vaults for a specific chain using Yearn's yDaemon
 */
export async function fetchYearnVaults(chainId: number): Promise<YearnVault[]> {
  try {
    const url = `${YDAEMON_BASE_URL}/${chainId}/vaults/all?limit=2500`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch Yearn vaults: ${res.statusText}`);
    }

    const rawVaults: any[] = await res.json();
    if (!Array.isArray(rawVaults)) {
      return [];
    }

    // Identify staking alias vaults (e.g. Staked yBOLD which is merged into Yearn BOLD on yearn.fi)
    const stakedYBold = rawVaults.find(
      (v) => v?.address && v.address.toLowerCase() === YBOLD_STAKING_ADDRESS
    );

    // Filter active, production vaults with TVL > 0 or endorsed
    const filtered: YearnVault[] = rawVaults
      .filter((v) => {
        if (!v || !v.address || !v.token) return false;
        const addr = v.address.toLowerCase();
        // Skip staking alias vaults that are merged into parent vault
        if (addr === YBOLD_STAKING_ADDRESS) return false;
        // Skip internal/auto-compounding wrappers not displayed as separate vaults on yearn.fi
        if (v.category === 'auto' || v.details?.category === 'auto') return false;
        if (v.details?.isRetired || v.details?.isHidden) return false;
        if (v.emergency_shutdown) return false;
        // Check TVL or endorsed
        const tvl = Number(v.tvl?.tvl || 0);
        return tvl > 100 || v.endorsed;
      })
      .map((v) => {
        const addr = v.address.toLowerCase();
        let netAPR = 0;
        let fees = v.apr?.fees;

        if (addr === YBOLD_VAULT_ADDRESS && stakedYBold) {
          // Merge staking yield & fees into Yearn BOLD, exactly matching yearn.fi UI
          const stakedWeekAgo = Number(stakedYBold.apr?.points?.weekAgo || 0);
          const stakedNet = Number(stakedYBold.apr?.netAPR || 0);
          netAPR = stakedWeekAgo > 0 ? stakedWeekAgo : (stakedNet > 0 ? stakedNet : 0.131);
          fees = {
            management: 0,
            performance:
              stakedYBold.apr?.fees?.performance !== undefined
                ? Number(stakedYBold.apr.fees.performance)
                : 0.1,
          };
        } else {
          // Yearn displays Est. APY (prioritizes forwardAPR when available over historical netAPR)
          const fwd = Number(v.apr?.forwardAPR?.netAPR || 0);
          const hist = Number(v.apr?.netAPR || 0);
          netAPR = fwd > 0 ? fwd : hist;
        }

        let computedName = v.name || v.displayName || 'Yearn Vault';
        let category = v.category || v.details?.category || 'General';
        let kind = v.kind || 'Single Asset';

        if (addr === YBOLD_VAULT_ADDRESS) {
          computedName = 'Yearn BOLD';
          category = 'Stablecoin';
          kind = 'Single Asset';
        } else if (v.category === 'Curve' && v.displayName && !computedName.endsWith('LP')) {
          computedName = `${v.displayName} LP`;
          kind = 'LP Token';
        } else if (v.kind?.toLowerCase().includes('curve') || v.category === 'Curve') {
          kind = 'LP Token';
        }

        // Yearn UI displays the deposit asset token icon as the primary icon
        const tokenIcon = v.token?.icon || v.icon;
        const vaultIcon = tokenIcon;

        return {
          address: v.address,
          type: v.type || 'Yearn Vault',
          kind,
          symbol: v.symbol || v.displaySymbol || 'yVault',
          displaySymbol: v.displaySymbol || v.symbol,
          name: computedName,
          displayName: v.displayName || v.name,
          icon: vaultIcon,
          version: v.version || '3.0.0',
          category,
          chainID: chainId,
          endorsed: !!v.endorsed,
          boosted: !!v.boosted,
          emergency_shutdown: !!v.emergency_shutdown,
          token: {
            address: v.token.address,
            name: v.token.name || v.token.symbol || 'Token',
            symbol: v.token.symbol || 'TOKEN',
            decimals: v.token.decimals || 18,
            icon: tokenIcon,
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
            fees,
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

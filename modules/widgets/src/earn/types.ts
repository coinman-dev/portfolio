export interface YearnToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
  description?: string;
}

export interface YearnAPRPoints {
  weekAgo?: number | null;
  monthAgo?: number | null;
  inception?: number | null;
}

export interface YearnPricePerSharePoints {
  today?: number | null;
  weekAgo?: number | null;
  monthAgo?: number | null;
}

export interface YearnForwardAPRComposite {
  boost?: number | null;
  poolAPY?: number | null;
  boostedAPR?: number | null;
  baseAPR?: number | null;
  cvxAPR?: number | null;
  rewardsAPR?: number | null;
  keepCRV?: number | null;
}

export interface YearnAPR {
  type?: string;
  netAPR: number | null;
  fees?: {
    performance?: number;
    management?: number;
  };
  points?: YearnAPRPoints;
  pricePerShare?: YearnPricePerSharePoints;
  extra?: {
    stakingRewardsAPR?: number | null;
    gammaRewardAPR?: number | null;
  };
  forwardAPR?: {
    type?: string;
    netAPR?: number | null;
    composite?: YearnForwardAPRComposite;
  };
}

export interface YearnTVL {
  totalAssets?: string;
  tvl: number;
  price?: number;
}

export interface YearnStrategyDetails {
  totalDebt?: string;
  totalLoss?: string;
  totalGain?: string;
  performanceFee?: number;
  lastReport?: number;
  /** Share of vault debt in basis points (0..10000). */
  debtRatio?: number;
}

export interface YearnStrategy {
  address: string;
  name: string;
  status?: string;
  netAPR?: number | null;
  details?: YearnStrategyDetails;
}

export interface YearnStaking {
  address?: string;
  available?: boolean;
  source?: string;
  rewards?: unknown;
}

export interface YearnInfo {
  riskLevel?: number;
  isRetired?: boolean;
  isHidden?: boolean;
  isBoosted?: boolean;
  isHighlighted?: boolean;
  riskScore?: number[];
}

export interface YearnVault {
  address: string;
  type: string;
  kind?: string;
  symbol: string;
  displaySymbol?: string;
  name: string;
  /** Untouched name from the API — vault classification depends on it. */
  rawName?: string;
  displayName?: string;
  icon?: string;
  version: string;
  category: string;
  chainID: number;
  decimals?: number;
  description?: string;
  endorsed?: boolean;
  boosted?: boolean;
  emergency_shutdown?: boolean;
  featuringScore?: number;
  pricePerShare?: string;
  token: YearnToken;
  tvl: YearnTVL;
  apr: YearnAPR;
  strategies?: YearnStrategy[];
  staking?: YearnStaking;
  info?: YearnInfo;
  details?: {
    isRetired?: boolean;
    isHidden?: boolean;
    category?: string;
  };
  /** yvUSD is shown as one row merging the unlocked and locked vaults. */
  lockedTwin?: {
    address: string;
    netAPR: number | null;
    monthAgo?: number | null;
    pricePerShare?: string;
    tvl?: number;
  };
  /** Address whose APY/charts represent this vault (yBOLD uses its staking contract). */
  dataAddress?: string;
  // User onchain state (hydrated when wallet connected)
  userTokenBalance?: {
    raw: bigint;
    formatted: string;
    usdValue: number;
  };
  userVaultBalance?: {
    raw: bigint;
    formatted: string;
    assetsUnderlying: bigint;
    formattedAssets: string;
    usdValue: number;
  };
}

export interface EarnMountOptions {
  container: HTMLElement;
  initialSettings?: Record<string, any>;
  onSettingsChange?: (settings: Record<string, any>) => void;
}

export interface EarnInstance {
  unmount: () => void;
}

export interface SupportedChain {
  id: number;
  name: string;
  shortName: string;
  icon: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
  /** yearn.fi only offers Ethereum, Katana, Base and OP Mainnet in the chain filter. */
  visibleInSelector: boolean;
}

export interface YearnToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
  description?: string;
}

export interface YearnAPR {
  type?: string;
  netAPR: number | null;
  fees?: {
    performance?: number;
    management?: number;
  };
  forwardAPR?: {
    netAPR?: number | null;
  };
}

export interface YearnTVL {
  totalAssets?: string;
  tvl: number;
  price?: number;
}

export interface YearnVault {
  address: string;
  type: string;
  kind?: string;
  symbol: string;
  displaySymbol?: string;
  name: string;
  displayName?: string;
  icon?: string;
  version: string;
  category: string;
  chainID: number;
  endorsed?: boolean;
  boosted?: boolean;
  emergency_shutdown?: boolean;
  token: YearnToken;
  tvl: YearnTVL;
  apr: YearnAPR;
  details?: {
    isRetired?: boolean;
    isHidden?: boolean;
    category?: string;
  };
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
}

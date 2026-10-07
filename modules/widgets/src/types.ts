export interface ConnectedWalletInfo {
  address: string;
  chainId?: number;
  connector?: string;
  connectedAt?: number;
}

export interface ExchangeMountOptions {
  container: HTMLElement;
  projectId?: string;
  initialSettings?: Record<string, any>;
  onSettingsChange?: (settings: Record<string, any>) => void;
  onWalletConnect?: (wallet: ConnectedWalletInfo) => void;
  onWalletDisconnect?: () => void;
}

export interface ExchangeInstance {
  unmount: () => void;
}

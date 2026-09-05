import ReactDOM from 'react-dom/client';
import { LiFiApp } from './LiFiApp';
import { mountCowSwap } from './cowswap';
import { ExchangeMountOptions, ExchangeInstance } from './types';
import * as wallet from './wallet';

export function mount(options: ExchangeMountOptions): ExchangeInstance {
  const root = ReactDOM.createRoot(options.container);
  root.render(<LiFiApp {...options} />);

  return {
    unmount: () => {
      root.unmount();
    },
  };
}

export const CoinmanWallet = {
  connect: wallet.connectWallet,
  disconnect: wallet.disconnectWallet,
  getStatus: wallet.getWalletStatus,
  subscribe: wallet.subscribeWalletStatus,
  getEthereumProvider: wallet.getEthereumProvider,
};

// Global hooks for easy dynamic loading in vanilla JS frontend
declare global {
  interface Window {
    CoinmanExchangeLiFi?: {
      mount: typeof mount;
    };
    CoinmanExchangeCowSwap?: {
      mount: typeof mountCowSwap;
    };
    CoinmanWallet?: typeof CoinmanWallet;
  }
}

if (typeof window !== 'undefined') {
  window.CoinmanExchangeLiFi = {
    mount,
  };
  window.CoinmanExchangeCowSwap = {
    mount: mountCowSwap,
  };
  window.CoinmanWallet = CoinmanWallet;
}

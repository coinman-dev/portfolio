import ReactDOM from 'react-dom/client';
import { LiFiApp } from './exchange/LiFiApp';
import { mountCowSwap } from './exchange/cowswap';
import { YearnApp } from './earn/YearnApp';
import { EarnMountOptions, EarnInstance } from './earn/types';
import { ExchangeMountOptions, ExchangeInstance } from './types';
import * as wallet from './wallet/wallet';
import './styles.css';

export function mountLiFi(options: ExchangeMountOptions): ExchangeInstance {
  const root = ReactDOM.createRoot(options.container);
  root.render(<LiFiApp {...options} />);

  return {
    unmount: () => {
      root.unmount();
    },
  };
}

export function mountYearn(options: EarnMountOptions): EarnInstance {
  const root = ReactDOM.createRoot(options.container);
  root.render(<YearnApp {...options} />);

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
      mount: typeof mountLiFi;
    };
    CoinmanExchangeCowSwap?: {
      mount: typeof mountCowSwap;
    };
    CoinmanEarnYearn?: {
      mount: typeof mountYearn;
    };
    CoinmanWallet?: typeof CoinmanWallet;
  }
}

if (typeof window !== 'undefined') {
  window.CoinmanExchangeLiFi = {
    mount: mountLiFi,
  };
  window.CoinmanExchangeCowSwap = {
    mount: mountCowSwap,
  };
  window.CoinmanEarnYearn = {
    mount: mountYearn,
  };
  window.CoinmanWallet = CoinmanWallet;
}

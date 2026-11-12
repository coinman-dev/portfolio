import ReactDOM from 'react-dom/client';
import { LiFiApp } from './exchange/LiFiApp';
import { mountCowSwap } from './exchange/cowswap';
import { BestRateApp } from './exchange/bestrate/BestRateApp';
import { ApprovalsApp } from './exchange/approvals/ApprovalsApp';
import { hideJumperView, showJumperView } from './exchange/jumperBridge';
import { cowSwapUrl, cowViewNeeded, hideCowView, showCowView } from './exchange/cowViewBridge';
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

export function mountBestRate(options: ExchangeMountOptions): ExchangeInstance {
  const root = ReactDOM.createRoot(options.container);
  root.render(<BestRateApp {...options} />);

  return {
    unmount: () => {
      root.unmount();
    },
  };
}

export function mountApprovals(options: ExchangeMountOptions): ExchangeInstance {
  const root = ReactDOM.createRoot(options.container);
  root.render(<ApprovalsApp {...options} />);

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
  listWallets: wallet.listWallets,
  addWallet: wallet.addWallet,
  selectWallet: wallet.selectWallet,
  reconnectWallet: wallet.reconnectWallet,
  removeWallet: wallet.removeWallet,
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
    CoinmanExchangeBestRate?: {
      mount: typeof mountBestRate;
    };
    CoinmanJumper?: {
      show: typeof showJumperView;
      hide: typeof hideJumperView;
    };
    CoinmanCowView?: {
      needed: typeof cowViewNeeded;
      url: typeof cowSwapUrl;
      show: typeof showCowView;
      hide: typeof hideCowView;
    };
    CoinmanApprovals?: {
      mount: typeof mountApprovals;
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
  window.CoinmanExchangeBestRate = {
    mount: mountBestRate,
  };
  window.CoinmanJumper = {
    show: showJumperView,
    hide: hideJumperView,
  };
  // Linux and macOS: CoW Swap in a native view (the widget's iframe is refused there).
  window.CoinmanCowView = {
    needed: cowViewNeeded,
    url: cowSwapUrl,
    show: showCowView,
    hide: hideCowView,
  };
  window.CoinmanApprovals = {
    mount: mountApprovals,
  };
  window.CoinmanEarnYearn = {
    mount: mountYearn,
  };
  window.CoinmanWallet = CoinmanWallet;
}

import {
  createCowSwapWidget,
  CowSwapWidgetHandler,
  CowSwapWidgetParams,
  CowSwapWidgetProps,
  TradeType,
} from '@cowprotocol/widget-lib';
import { getEthereumProvider, subscribeWalletStatus, WalletStatus } from '../wallet/wallet';

export interface CowSwapMountOptions {
  container: HTMLElement;
  initialSettings?: any;
  onSettingsChange?: (settings: any) => void;
}

export interface CowSwapInstance {
  unmount: () => void;
  updateProvider: (provider?: any) => void;
  getHandler: () => CowSwapWidgetHandler;
}

export async function mountCowSwap(options: CowSwapMountOptions): Promise<CowSwapInstance> {
  const { container, initialSettings, onSettingsChange: _onSettingsChange } = options;

  let currentProvider: any = undefined;
  try {
    currentProvider = await getEthereumProvider();
  } catch (e) {
    console.warn('[CoinMan CoW Swap] Could not get initial provider:', e);
  }

  // Convert slippage from percent (e.g. 0.25) to basis points (e.g. 25 bps)
  const slippageBps = initialSettings?.slippage
    ? Math.max(1, Math.round(Number(initialSettings.slippage) * 100))
    : undefined;

  const params: CowSwapWidgetParams = {
    appCode: 'CoinMan-Portfolio',
    rootStyle: {
      width: '100%',
      maxWidth: '100%',
      height: '640px',
      border: 'none',
      borderRadius: '16px',
    },
    width: '100%',
    height: '640px',
    theme: 'dark',
    tradeType: TradeType.SWAP,
    ...(slippageBps ? { slippageBps } : {}),
  };

  const widgetProps: CowSwapWidgetProps = {
    params,
    provider: currentProvider,
  };

  const handler: CowSwapWidgetHandler = createCowSwapWidget(container, widgetProps);

  // Keep CoW Swap provider in sync with OneKey HD / WalletConnect
  const unsubscribeWallet = subscribeWalletStatus((status: WalletStatus) => {
    if (status.isConnected) {
      getEthereumProvider()
        .then((provider) => {
          if (provider && handler?.updateProvider) {
            handler.updateProvider(provider);
          }
        })
        .catch((e) => {
          console.warn('[CoinMan CoW Swap] Error updating provider on wallet connect:', e);
        });
    } else {
      if (handler?.updateProvider) {
        handler.updateProvider(undefined);
      }
    }
  });

  return {
    unmount: () => {
      try {
        unsubscribeWallet();
      } catch (e) {}
      try {
        if (typeof handler?.destroy === 'function') {
          handler.destroy();
        } else if (container) {
          container.innerHTML = '';
        }
      } catch (e) {
        console.warn('[CoinMan CoW Swap] Error unmounting widget:', e);
      }
    },
    updateProvider: (provider?: any) => {
      if (handler?.updateProvider) {
        handler.updateProvider(provider);
      }
    },
    getHandler: () => handler,
  };
}

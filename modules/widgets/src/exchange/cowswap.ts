import {
  createCowSwapWidget,
  CowSwapWidgetHandler,
  CowSwapWidgetParams,
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
  const { container, initialSettings, onSettingsChange } = options;

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
    theme: {
      baseTheme: 'dark',
      primary: '#ff8c00',
      background: '#121318',
      paper: '#1a1c23',
      text: '#ffffff',
    },
    tradeType: TradeType.SWAP,
    provider: currentProvider,
    ...(slippageBps ? { slippageBps } : {}),
  };

  const handler: CowSwapWidgetHandler = createCowSwapWidget(container, params);

  // Subscribe to trade/quote events to propagate settings back to CoinMan
  try {
    handler.on('tradeParamsChanged', (data: any) => {
      console.log('[CoinMan CoW Swap] Trade params changed:', data);
      if (onSettingsChange && data?.slippageBps) {
        onSettingsChange({
          slippage: Number(data.slippageBps) / 100,
        });
      }
    });
  } catch (e) {
    console.warn('[CoinMan CoW Swap] Could not attach tradeParamsChanged listener:', e);
  }

  // Keep CoW Swap provider in sync with OneKey HD / WalletConnect
  const unsubscribeWallet = subscribeWalletStatus((status: WalletStatus) => {
    if (status.isConnected) {
      getEthereumProvider()
        .then((provider) => {
          if (provider && handler?.updateParams) {
            handler.updateParams({ provider });
          }
        })
        .catch((e) => {
          console.warn('[CoinMan CoW Swap] Error updating provider on wallet connect:', e);
        });
    } else {
      if (handler?.updateParams) {
        handler.updateParams({ provider: undefined });
      }
    }
  });

  return {
    unmount: () => {
      try {
        unsubscribeWallet();
      } catch (e) {}
      try {
        if (typeof handler?.unmount === 'function') {
          handler.unmount();
        } else if (container) {
          container.innerHTML = '';
        }
      } catch (e) {
        console.warn('[CoinMan CoW Swap] Error unmounting widget:', e);
      }
    },
    updateProvider: (provider?: any) => {
      if (handler?.updateParams) {
        handler.updateParams({ provider });
      }
    },
    getHandler: () => handler,
  };
}

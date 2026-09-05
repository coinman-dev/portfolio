import {
  createCowSwapWidget,
  CowSwapWidgetHandler,
  CowSwapWidgetParams,
  TradeType,
} from '@cowprotocol/widget-lib';
import { getEthereumProvider, subscribeWalletStatus, WalletStatus } from './wallet';

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
      maxWidth: '460px',
      height: 'var(--dynamicHeight, 460px)',
      margin: '0 auto',
      borderRadius: '16px',
      overflow: 'hidden',
      backgroundColor: 'transparent',
    },
    chainId: (initialSettings?.chainId as any) || 1,
    tradeType: TradeType.SWAP,
    theme: 'dark', // Native official Dark mode from CoW Protocol
    disableScrollbars: true,
    slippage: slippageBps
      ? {
          defaultValue: slippageBps,
        }
      : undefined,
    standaloneMode: false,
  };

  const handler = createCowSwapWidget(container, {
    params,
    provider: currentProvider || undefined,
    onReady: () => {
      console.log('[CoinMan CoW Swap] Widget is ready');
    },
    onLoadingError: () => {
      console.error('[CoinMan CoW Swap] Widget failed to load');
    },
  });

  if (handler.iframe) {
    handler.iframe.style.backgroundColor = 'transparent';
    handler.iframe.setAttribute('allowtransparency', 'true');
  }

  if (onSettingsChange) {
    onSettingsChange({
      activeModule: 'cowswap',
    });
  }

  const unsubscribe = subscribeWalletStatus(async (status: WalletStatus) => {
    try {
      if (status.isConnected) {
        const p = await getEthereumProvider();
        handler.updateProvider(p || undefined);
      } else {
        handler.updateProvider(undefined);
      }
    } catch (err) {
      console.warn('[CoinMan CoW Swap] Error updating provider on wallet change:', err);
    }
  });

  return {
    unmount: () => {
      unsubscribe();
      try {
        handler.destroy();
      } catch (e) {
        console.warn('[CoinMan CoW Swap] Error destroying widget:', e);
      }
    },
    updateProvider: (p?: any) => {
      handler.updateProvider(p);
    },
    getHandler: () => handler,
  };
}

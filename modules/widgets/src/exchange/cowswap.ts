import {
  createCowSwapWidget,
  CowSwapWidgetHandler,
  CowSwapWidgetParams,
  CowSwapWidgetProps,
  TradeType,
} from '@cowprotocol/widget-lib';
import { getEthereumProvider, subscribeWalletStatus, WalletStatus } from '../wallet/wallet';
import { diag } from '../diag';

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

// @cowprotocol/iframe-transport (checked up to 2.3.8) never removes its RPC message
// listener on disconnect: it unregisters the raw handler, not the wrapper it added.
// Every handler.updateProvider() therefore leaves one more forwarder behind, and a
// single request from the CoW iframe reaches the wallet once per forwarder — the
// user gets the same "sign order" prompt again after the swap already went through.
// The forwarders fire synchronously for one message and all reuse the iframe's
// JSON-RPC id, so sharing the in-flight promise per id leaves exactly one prompt.
const dedupedProviders = new WeakMap<object, any>();

/** Requests that put a prompt in front of the user in the wallet. */
const WALLET_PROMPT_METHODS = new Set([
  'eth_requestAccounts',
  'eth_sendTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_watchAsset',
  'wallet_sendCalls',
]);

type RpcArgs = { id?: unknown; method?: string };

/** Diagnostic log: wallet prompts both ways, other calls only when they fail. */
function traceRpc(args: RpcArgs, call: Promise<unknown>): Promise<unknown> {
  const prompt = WALLET_PROMPT_METHODS.has(args.method ?? '');
  const what = `RPC ${args.method} id=${args.id}`;
  const started = Date.now();
  if (prompt) diag('info', 'COW', `${what} → wallet`);
  return call.then(
    (result) => {
      if (prompt) diag('info', 'COW', `${what} ok (${Date.now() - started} ms)`);
      return result;
    },
    (err) => {
      const ms = Date.now() - started;
      if (err?.code === 4001) {
        diag('info', 'COW', `${what} rejected by user (${ms} ms)`);
      } else {
        diag('warn', 'COW', `${what} failed (${ms} ms): ${err?.code ?? ''} ${err?.message ?? err}`);
      }
      throw err;
    },
  );
}

function withDedupedRequests(provider: any): any {
  if (!provider) return undefined;
  let wrapped = dedupedProviders.get(provider);
  if (wrapped) return wrapped;

  const inFlight = new Map<unknown, Promise<unknown>>();
  const request = (args: RpcArgs) => {
    const id = args?.id;
    if (id === undefined || id === null) return provider.request(args);
    let pending = inFlight.get(id);
    if (pending) {
      diag('debug', 'COW', `RPC ${args.method} id=${id} duplicate dropped`);
    } else {
      const call = new Promise((resolve) => resolve(provider.request(args)));
      pending = traceRpc(args, call).finally(() => {
        inFlight.delete(id);
      });
      inFlight.set(id, pending);
    }
    return pending;
  };

  wrapped = new Proxy(provider, {
    get(target, prop) {
      if (prop === 'request') return request;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  dedupedProviders.set(provider, wrapped);
  return wrapped;
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

  let widgetProvider = withDedupedRequests(currentProvider);

  // Toasts cover the order lifecycle (created, signing error, filled, expired,
  // on-chain tx failed) and are the only view into errors inside the iframe.
  const listeners = [
    {
      event: 'ON_TOAST_MESSAGE',
      handler: (toast: { messageType: string; message: string; data?: unknown }) => {
        const failed =
          toast.messageType === 'SWAP_SIGNING_ERROR' ||
          toast.messageType === 'ONCHAIN_TRANSACTION_FAILED';
        diag(failed ? 'warn' : 'info', 'COW', `${toast.messageType}: ${toast.message}`, toast.data);
      },
    },
  ] as CowSwapWidgetProps['listeners'];

  const widgetProps: CowSwapWidgetProps = {
    params,
    provider: widgetProvider,
    listeners,
  };

  diag('info', 'COW', `mount, wallet provider ${widgetProvider ? 'present' : 'missing'}`);
  const handler: CowSwapWidgetHandler = createCowSwapWidget(container, widgetProps);

  // Each updateProvider() leaks a forwarder (see withDedupedRequests), so only call
  // it when the provider really changes. The WalletConnect connector hands out the
  // same provider object every time; account and chain changes reach the widget
  // through that provider's own events.
  const setWidgetProvider = (provider?: any) => {
    const next = withDedupedRequests(provider);
    if (next === widgetProvider) return;
    diag('info', 'COW', next ? 'wallet provider set' : 'wallet provider cleared');
    widgetProvider = next;
    handler.updateProvider(next);
  };

  // Keep CoW Swap provider in sync with OneKey HD / WalletConnect
  const unsubscribeWallet = subscribeWalletStatus((status: WalletStatus) => {
    if (status.isConnected) {
      getEthereumProvider()
        .then((provider) => {
          if (provider) {
            setWidgetProvider(provider);
          }
        })
        .catch((e) => {
          console.warn('[CoinMan CoW Swap] Error updating provider on wallet connect:', e);
        });
    } else {
      setWidgetProvider(undefined);
    }
  });

  return {
    unmount: () => {
      diag('info', 'COW', 'unmount');
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
    updateProvider: setWidgetProvider,
    getHandler: () => handler,
  };
}

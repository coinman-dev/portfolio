import { getPublicClient, switchChain } from '@wagmi/core';
import { numberToHex } from 'viem';
import { getEthereumProvider, getWalletStatus, subscribeWalletStatus, wagmiConfig } from '../wallet/wallet';
import { onOverlayChange, overlayHeld } from '../wallet/overlay';
import { diag } from '../diag';

/**
 * CoW Swap on Linux and macOS. WebKit refuses the CoW widget's iframe there
 * (swap.cow.fi's `frame-ancestors *` does not cover the app's
 * `tauri://localhost`), so swap.cow.fi runs in a native view over the Exchange
 * area instead (src-tauri/src/cow_view.rs), the way Jumper does.
 *
 * The site's EIP-1193 calls arrive here. They go to the wallet as they would
 * from the widget's iframe on Windows — no route whitelist, so limit orders,
 * TWAP and custom recipients keep working — but only from the connected
 * account, on its network, and only the methods CoW Swap needs.
 */

/** Plain reads the site may make through the wallet; served from public RPCs. */
const READ_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
]);

const WALLET_CHAINS = wagmiConfig.chains.map((c) => c.id as number);

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

/** Whether CoW Swap opens in the native view here (not on Windows, where the iframe works). */
export const cowViewNeeded = (): boolean => !/Windows/.test(navigator.userAgent);

function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  const tauri = (window as any).__TAURI__;
  if (!tauri?.core?.invoke) return Promise.reject(new Error('not running in CoinMan'));
  return tauri.core.invoke(command, args);
}

function openWalletList(): void {
  void (window as any).AppExchange?.handleWalletClick?.();
}

function requireChain(params: any): number {
  const id = Number(params?.[0]?.chainId);
  if (!Number.isFinite(id)) throw new RpcError(-32602, 'missing chainId');
  if (!WALLET_CHAINS.includes(id)) {
    throw new RpcError(4902, `Network ${id} is not enabled in CoinMan's wallet connection.`);
  }
  return id;
}

function sameAccount(value: unknown, account: string): boolean {
  return String(value ?? '').toLowerCase() === account.toLowerCase();
}

async function toWallet(method: string, params: any): Promise<unknown> {
  const provider = await getEthereumProvider();
  if (!provider) throw new RpcError(4900, 'The wallet is not connected.');
  diag('info', 'COW', `RPC ${method} → wallet`);
  return provider.request({ method, params });
}

async function handle(method: string, params: any): Promise<unknown> {
  const status = getWalletStatus();
  const account = status.isConnected ? status.address : undefined;
  const chainId = status.chainId ?? 0;

  switch (method) {
    case 'eth_accounts':
      return account ? [account] : [];
    case 'eth_requestAccounts':
      if (account) return [account];
      openWalletList();
      throw new RpcError(4001, 'Connect a wallet in CoinMan first, then press Connect again.');
    case 'eth_chainId':
      return numberToHex(status.chainId ?? 1);
    case 'net_version':
      return String(status.chainId ?? 1);
    case 'wallet_requestPermissions':
      return [{ parentCapability: 'eth_accounts' }];
    case 'wallet_getPermissions':
      return account ? [{ parentCapability: 'eth_accounts' }] : [];
    case 'wallet_getCapabilities':
      // No batching: every step comes as its own transaction.
      return {};
    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain': {
      const next = requireChain(params);
      await switchChain(wagmiConfig, { chainId: next as any });
      pushState();
      return null;
    }
    case 'eth_sendTransaction': {
      const tx = params?.[0] ?? {};
      if (!account || !sameAccount(tx.from, account)) {
        throw new RpcError(4100, 'The transaction is not from the connected CoinMan wallet.');
      }
      if (tx.chainId != null && Number(tx.chainId) !== chainId) {
        throw new RpcError(4901, 'Switch the network first.');
      }
      return toWallet(method, params);
    }
    case 'eth_signTypedData_v4': {
      const [signer] = Array.isArray(params) ? params : [];
      if (!account || !sameAccount(signer, account)) {
        throw new RpcError(4100, 'The signature is not for the connected CoinMan wallet.');
      }
      return toWallet(method, params);
    }
    case 'personal_sign': {
      const [, signer] = Array.isArray(params) ? params : [];
      if (!account || !sameAccount(signer, account)) {
        throw new RpcError(4100, 'The signature is not for the connected CoinMan wallet.');
      }
      return toWallet(method, params);
    }
  }
  if (READ_METHODS.has(method)) {
    const client = getPublicClient(wagmiConfig, { chainId: (status.chainId ?? 1) as any });
    return client.request({ method, params } as any);
  }
  diag('warn', 'COW', `refused ${method}`);
  throw new RpcError(4200, `CoinMan does not support ${method} for CoW Swap.`);
}

function pushState(): void {
  const status = getWalletStatus();
  void invoke('cow_wallet_state', {
    state: {
      accounts: status.isConnected && status.address ? [status.address] : [],
      chainId: status.chainId ?? null,
    },
  }).catch(() => undefined);
}

let started = false;

async function startBridge(): Promise<void> {
  if (started) return;
  const events = (window as any).__TAURI__?.event;
  if (!events?.listen) throw new Error('not running in CoinMan');
  started = true;
  await events.listen('cow-wallet-request', async (event: any) => {
    const { id, method, params } = event.payload ?? {};
    let response: unknown;
    try {
      response = { result: (await handle(String(method), params)) ?? null };
    } catch (err: any) {
      const code = err instanceof RpcError ? err.code : (err?.code ?? 4001);
      if (code === 4001) diag('info', 'COW', `RPC ${method} rejected`);
      else diag('warn', 'COW', `RPC ${method} failed: ${code} ${err?.message ?? err}`);
      response = { error: { code, message: err?.shortMessage ?? err?.message ?? String(err) } };
    }
    await invoke('cow_wallet_response', { id, response }).catch((err) =>
      diag('error', 'COW', `answer for call ${id} lost: ${err}`)
    );
  });
  subscribeWalletStatus(() => pushState());
  pushState();
}

/** swap.cow.fi address for a pair and amount (Best Rate routes). */
export function cowSwapUrl(trade?: { chainId: number; sell: string; buy: string; sellAmount?: string }): string | undefined {
  if (!trade) return undefined;
  const base = `https://swap.cow.fi/#/${trade.chainId}/swap/${trade.sell}/${trade.buy}`;
  return trade.sellAmount ? `${base}?sellAmount=${encodeURIComponent(trade.sellAmount)}` : base;
}

// ─── The native view ─────────────────────────────────────────────────────────
//
// Native layers cover any HTML under them, so the view is shown only while
// its container is really on screen and none of our menus or pop-ups is open.

let container: HTMLElement | null = null;
let pendingUrl: string | undefined;
let shown = false;
let lastBounds = '';
let frame = 0;
let cleanup: (() => void) | null = null;

function overlayOpen(): boolean {
  return overlayHeld() || !!document.querySelector('.dropdown-menu.show, .modal.open');
}

function sync(): void {
  frame = 0;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const onScreen = container.offsetParent !== null && rect.width > 40 && rect.height > 40;
  if (!onScreen || overlayOpen()) {
    if (shown) {
      shown = false;
      void invoke('cow_hide', {}).catch(() => undefined);
    }
    return;
  }
  const bounds = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  const key = JSON.stringify(bounds);
  if (shown && key === lastBounds && !pendingUrl) return;
  lastBounds = key;
  shown = true;
  const url = pendingUrl;
  pendingUrl = undefined;
  void invoke('cow_show', { bounds, url: url ?? null }).catch((err) => {
    shown = false;
    diag('error', 'COW', `cannot show the CoW Swap view: ${err}`);
  });
}

function scheduleSync(): void {
  if (!frame) frame = requestAnimationFrame(sync);
}

/** Shows swap.cow.fi over `el` (opening `url` if given) and keeps it placed there. */
export async function showCowView(el: HTMLElement, url?: string): Promise<void> {
  await startBridge();
  container = el;
  if (url) pendingUrl = url;
  if (!cleanup) {
    const mutations = new MutationObserver(scheduleSync);
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    const resize = new ResizeObserver(scheduleSync);
    resize.observe(el);
    const offOverlay = onOverlayChange(scheduleSync);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('scroll', scheduleSync, true);
    cleanup = () => {
      mutations.disconnect();
      resize.disconnect();
      offOverlay();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('scroll', scheduleSync, true);
    };
  }
  lastBounds = '';
  scheduleSync();
}

/** Takes the CoW Swap view off screen (it keeps its page for next time). */
export function hideCowView(): void {
  cleanup?.();
  cleanup = null;
  container = null;
  shown = false;
  void invoke('cow_hide', {}).catch(() => undefined);
}

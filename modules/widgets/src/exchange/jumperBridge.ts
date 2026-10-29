import { getPublicClient, switchChain } from '@wagmi/core';
import { numberToHex } from 'viem';
import { getEthereumProvider, getWalletStatus, subscribeWalletStatus, wagmiConfig } from '../wallet/wallet';
import { onOverlayChange, overlayHeld } from '../wallet/overlay';
import { diag } from '../diag';
import { checkJumperSignature, checkJumperTransaction, type AmountHints } from './jumperGuard';

/**
 * The main window's half of Jumper Exchange: jumper.xyz (in a native view
 * over the Exchange area) sends EIP-1193 calls here through the app, and
 * `jumperGuard` checks every transaction and signature against the whitelist
 * (LI.FI, Uniswap, CoW, Velora Delta, FYND) before WalletConnect sees it.
 * Approvals above the swap amount are cut down to it; the amounts come with
 * each call from the page script (`hints`).
 *
 * A refusal goes back as 4100, not 4001: to the site 4001 means the user
 * declined, and it would show "Signature required" instead of the reason.
 */

/** Code for a call the safety check refused (EIP-1193 "unauthorized"). */
const BLOCKED = 4100;

/** The guard's refusal, with what to do instead. */
function blocked(err: any): RpcError {
  const reason = String(err?.message ?? 'Blocked by CoinMan safety check');
  return new RpcError(
    BLOCKED,
    `${reason}. CoinMan signs only whitelisted routes (LI.FI, Uniswap, CoW, Velora, FYND) for the swap amount — ` +
      'pick another route in the route list.'
  );
}

const WALLET_CHAINS = wagmiConfig.chains.map((c) => c.id as number);

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

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

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

async function handle(method: string, params: any, hints: AmountHints | undefined): Promise<unknown> {
  const status = getWalletStatus();
  const account = status.isConnected ? status.address : undefined;

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
      // No batching: every step comes as its own transaction, checked on its own.
      return {};
    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain': {
      const chainId = requireChain(params);
      await switchChain(wagmiConfig, { chainId: chainId as any });
      pushState();
      return null;
    }
    case 'eth_sendTransaction': {
      const tx = params?.[0] ?? {};
      if (!account || String(tx.from ?? '').toLowerCase() !== account.toLowerCase()) {
        throw new RpcError(4100, 'The transaction is not from the connected CoinMan wallet.');
      }
      const chainId = status.chainId ?? 0;
      if (tx.chainId != null && Number(tx.chainId) !== chainId) {
        throw new RpcError(4901, 'Switch the network first.');
      }
      let checked;
      try {
        checked = checkJumperTransaction(chainId, tx, hints);
      } catch (err: any) {
        throw blocked(err);
      }
      const provider = await getEthereumProvider();
      if (!provider) throw new RpcError(4900, 'The wallet is not connected.');
      diag('info', 'JUMPER', `sending ${checked.label} (${tx.to}) on chain ${chainId}`);
      const sent = checked.data ? [{ ...tx, data: checked.data }, ...params.slice(1)] : params;
      return provider.request({ method, params: sent });
    }
    case 'eth_signTypedData_v4': {
      const [signer, typedData] = Array.isArray(params) ? params : [];
      if (!account || String(signer ?? '').toLowerCase() !== account.toLowerCase()) {
        throw new RpcError(4100, 'The permit is not for the connected CoinMan wallet.');
      }
      const chainId = status.chainId ?? 0;
      let label;
      try {
        label = checkJumperSignature(chainId, account, typedData, hints);
      } catch (err: any) {
        // The whole request, so the log shows what the site wanted signed.
        diag('warn', 'JUMPER', 'refused typed data', typedData);
        throw blocked(err);
      }
      const provider = await getEthereumProvider();
      if (!provider) throw new RpcError(4900, 'The wallet is not connected.');
      diag('info', 'JUMPER', `signing a ${label} on chain ${chainId}`);
      return provider.request({ method, params });
    }
  }
  if (READ_METHODS.has(method)) {
    const client = getPublicClient(wagmiConfig, { chainId: (status.chainId ?? 1) as any });
    return client.request({ method, params } as any);
  }
  diag('warn', 'JUMPER', `refused ${method}`);
  throw new RpcError(4200, `CoinMan does not allow ${method} for Jumper — only whitelisted transactions, permits and orders are signed.`);
}

function pushState(): void {
  const status = getWalletStatus();
  void invoke('jumper_wallet_state', {
    state: {
      accounts: status.isConnected && status.address ? [status.address] : [],
      chainId: status.chainId ?? null,
    },
  }).catch(() => undefined);
}

let started = false;

/** Starts answering jumper.xyz's wallet calls; safe to call more than once. */
export async function startJumperBridge(): Promise<void> {
  if (started) return;
  const events = (window as any).__TAURI__?.event;
  if (!events?.listen) throw new Error('not running in CoinMan');
  started = true;
  await events.listen('jumper-wallet-request', async (event: any) => {
    const { id, method, params, hints } = event.payload ?? {};
    let response: unknown;
    try {
      const amounts = hints && typeof hints === 'object' ? (hints as AmountHints) : undefined;
      response = { result: (await handle(String(method), params, amounts)) ?? null };
    } catch (err: any) {
      const code = err instanceof RpcError ? err.code : (err?.code ?? 4001);
      response = { error: { code, message: err?.shortMessage ?? err?.message ?? String(err) } };
    }
    await invoke('jumper_wallet_response', { id, response }).catch((err) =>
      diag('error', 'JUMPER', `answer for call ${id} lost: ${err}`)
    );
  });
  subscribeWalletStatus(() => pushState());
  pushState();
}

// ─── The embedded view ───────────────────────────────────────────────────────
//
// jumper.xyz is a native webview laid over `container`. Native layers cover
// any HTML under them, so it is shown only while the container is really on
// screen and none of our menus or pop-ups is open; one watcher on the page
// covers view and tab switches, menus, modals and resizing.

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
      void invoke('jumper_hide', {}).catch(() => undefined);
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
  void invoke('jumper_show', { bounds, url: url ?? null }).catch((err) => {
    shown = false;
    diag('error', 'JUMPER', `cannot show the Jumper view: ${err}`);
  });
}

function scheduleSync(): void {
  if (!frame) frame = requestAnimationFrame(sync);
}

/** Shows jumper.xyz over `el` (opening `url` if given) and keeps it placed there. */
export async function showJumperView(el: HTMLElement, url?: string): Promise<void> {
  await startJumperBridge();
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

/** Takes the Jumper view off screen (it keeps its page for next time). */
export function hideJumperView(): void {
  cleanup?.();
  cleanup = null;
  container = null;
  shown = false;
  void invoke('jumper_hide', {}).catch(() => undefined);
}

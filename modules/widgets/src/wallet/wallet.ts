import { createConfig, http, type Transport } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import {
  connect,
  disconnect,
  getAccount,
  getConnections,
  reconnect,
  switchConnection,
  watchAccount,
  watchConnections,
  type Connector,
  type CreateConnectorFn,
} from '@wagmi/core';
import { diag } from '../diag';
import { forgetWalletConnectStorage, walletConnectStorage, walletStore } from './store';
import { holdOverlay } from './overlay';
import { WALLET_CHAINS } from './chains';

export const PROJECT_ID = '927c5d6fc3d30f43842ac0b9e0714891';

export const defaultMetadata = {
  name: 'CoinMan Portfolio Tracker',
  description: 'Cross-Chain Crypto Exchange & Portfolio',
  url: 'https://coinman.dev',
  icons: ['https://coinman.dev/images/coinman.dev.webp'],
};

/**
 * EVM pairings ask for eip155 only. OneKey, for one, speaks only EVM (and
 * Algorand) over WalletConnect and rejects a whole pairing that also asks
 * for Tron or Solana; those get pairings of their own (wallet/tron.ts,
 * wallet/solana.ts) with wallets that support them.
 */

// ─── Saved wallets ──────────────────────────────────────────────────────────

/** A wallet the user connected. Kept, with its session, until they remove it. */
interface SavedWallet {
  id: string;
  addedAt: number;
  /** Wallet app from the WalletConnect session, e.g. "OneKey". */
  name?: string;
  /** Last known account and chain, shown while the wallet is offline. */
  address?: string;
  chainId?: number;
}

const WALLETS_KEY = 'coinman.wallets';
const ACTIVE_WALLET_KEY = 'coinman.activeWallet';
const CONNECTOR_ID_PREFIX = 'walletConnect:';

function loadSavedWallets(): SavedWallet[] {
  try {
    const list = JSON.parse(walletStore.get(WALLETS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((w) => w && typeof w.id === 'string') : [];
  } catch {
    return [];
  }
}

let savedWallets = loadSavedWallets();

function saveWallets(list: SavedWallet[]): void {
  savedWallets = list;
  walletStore.set(WALLETS_KEY, JSON.stringify(list));
}

function updateSavedWallet(id: string, patch: Partial<SavedWallet>): void {
  const current = savedWallets.find((w) => w.id === id);
  if (!current) return;
  const next = { ...current, ...patch };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  saveWallets(savedWallets.map((w) => (w.id === id ? next : w)));
}

function getActiveWalletId(): string | null {
  return walletStore.get(ACTIVE_WALLET_KEY);
}

function setActiveWalletId(id: string | null | undefined): void {
  if (id) walletStore.set(ACTIVE_WALLET_KEY, id);
  else walletStore.remove(ACTIVE_WALLET_KEY);
}

/**
 * One WalletConnect connector per saved wallet. Each has its own WalletConnect
 * client and storage namespace, so several wallets stay connected side by
 * side and their sessions survive a restart.
 */
function walletConnector(walletId: string): CreateConnectorFn {
  const connectorFn = walletConnect({
    projectId: PROJECT_ID,
    metadata: defaultMetadata,
    showQrModal: true,
    qrModalOptions: {
      themeMode: 'dark',
      themeVariables: {
        '--wcm-z-index': '10001',
      },
    },
    customStoragePrefix: walletId,
    storage: walletConnectStorage(walletId),
    // wagmi remembers the chains it asked for in its own storage, under a key
    // all WalletConnect connectors share, and that storage does not survive a
    // restart. Left on, this would drop every restored session as "stale".
    isNewChainsStale: false,
  });
  return ((config) => ({
    ...connectorFn(config),
    id: CONNECTOR_ID_PREFIX + walletId,
  })) as CreateConnectorFn;
}

function walletIdOf(connector?: { id: string }): string | undefined {
  return connector?.id.startsWith(CONNECTOR_ID_PREFIX)
    ? connector.id.slice(CONNECTOR_ID_PREFIX.length)
    : undefined;
}

export const wagmiConfig = createConfig({
  chains: WALLET_CHAINS,
  connectors: savedWallets.map((w) => walletConnector(w.id)),
  transports: Object.fromEntries(WALLET_CHAINS.map((chain) => [chain.id, http()])) as Record<
    (typeof WALLET_CHAINS)[number]['id'],
    Transport
  >,
});

function connectorFor(walletId: string): Connector | undefined {
  return wagmiConfig.connectors.find((c) => walletIdOf(c) === walletId);
}

function isConnected(connector: Connector): boolean {
  return getConnections(wagmiConfig).some((c) => c.connector.uid === connector.uid);
}

async function peerName(connector: Connector): Promise<string | undefined> {
  const provider: any = await connector.getProvider().catch(() => undefined);
  return provider?.session?.peer?.metadata?.name;
}

/** Stops the relay connection of a WalletConnect client that is no longer used. */
async function closeClient(connector: Connector): Promise<void> {
  try {
    const provider: any = await connector.getProvider();
    await provider?.signer?.client?.core?.relayer?.transportClose?.();
  } catch {}
}

function dropConnector(connector: Connector): void {
  wagmiConfig._internal.connectors.setState((list) => list.filter((c) => c.uid !== connector.uid));
}

// ─── Status ─────────────────────────────────────────────────────────────────

/**
 * The selected wallet. `isConnected` means it can sign right now. A selected
 * wallet that is not connected still has its last known `address`, with
 * `readOnly` set: balances, Earn positions and approvals are shown for it,
 * and only signing waits until it is reconnected.
 */
export interface WalletStatus {
  isConnected: boolean;
  readOnly: boolean;
  address?: string;
  chainId?: number;
  shortAddress?: string;
  walletId?: string;
  walletName?: string;
}

/** A saved wallet as the wallet list shows it. */
export interface WalletInfo {
  id: string;
  name: string;
  address?: string;
  shortAddress?: string;
  chainId?: number;
  chainName?: string;
  connected: boolean;
  /** The wallet Exchange and Earn use. */
  selected: boolean;
}

export type WalletStatusListener = (status: WalletStatus) => void;

function formatShortAddress(addr?: string): string {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function chainName(chainId?: number): string | undefined {
  return wagmiConfig.chains.find((c) => c.id === chainId)?.name;
}

export function getWalletStatus(): WalletStatus {
  const acc = getAccount(wagmiConfig);
  const activeId = getActiveWalletId();
  const saved = savedWallets.find((w) => w.id === activeId);
  // The selected wallet, connected and the one wagmi signs with.
  if (saved && walletIdOf(acc.connector) === saved.id && acc.isConnected && acc.address) {
    return {
      isConnected: true,
      readOnly: false,
      address: acc.address,
      chainId: acc.chainId,
      shortAddress: formatShortAddress(acc.address),
      walletId: saved.id,
      walletName: saved.name,
    };
  }
  // Selected but offline: its last known address, to look at only.
  if (saved?.address) {
    return {
      isConnected: false,
      readOnly: true,
      address: saved.address,
      chainId: saved.chainId,
      shortAddress: formatShortAddress(saved.address),
      walletId: saved.id,
      walletName: saved.name,
    };
  }
  const walletId = walletIdOf(acc.connector);
  return {
    isConnected: !!acc.isConnected && !!acc.address,
    readOnly: false,
    address: acc.address,
    chainId: acc.chainId,
    shortAddress: formatShortAddress(acc.address),
    walletId,
    walletName: savedWallets.find((w) => w.id === walletId)?.name,
  };
}

export function listWallets(): WalletInfo[] {
  const connections = getConnections(wagmiConfig);
  const activeId = getActiveWalletId();
  return savedWallets.map((w) => {
    const connection = connections.find((c) => walletIdOf(c.connector) === w.id);
    const address = connection?.accounts[0] ?? w.address;
    const chainId = connection?.chainId ?? w.chainId;
    return {
      id: w.id,
      name: w.name || 'Wallet',
      address,
      shortAddress: formatShortAddress(address),
      chainId,
      chainName: chainName(chainId),
      connected: !!connection,
      selected: w.id === activeId,
    };
  });
}

export async function getEthereumProvider(): Promise<any> {
  const acc = getAccount(wagmiConfig);
  if (acc.isConnected && acc.connector) {
    try {
      return await acc.connector.getProvider();
    } catch (e) {
      console.warn('[CoinmanWallet] Could not get connector provider:', e);
    }
  }
  return null;
}

const listeners = new Set<WalletStatusListener>();

function notify(): void {
  const status = getWalletStatus();
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch (e) {
      console.error('[CoinmanWallet] Error in listener:', e);
    }
  });
}

/** Called with the current wallet's status on every change, the wallet list included. */
export function subscribeWalletStatus(fn: WalletStatusListener): () => void {
  listeners.add(fn);
  fn(getWalletStatus());
  return () => {
    listeners.delete(fn);
  };
}

watchAccount(wagmiConfig, {
  onChange(account) {
    const walletId = walletIdOf(account.connector);
    diag(
      'info',
      'WALLET',
      `${account.status} ${formatShortAddress(account.address) || '-'} chain=${account.chainId ?? '-'} wallet=${walletId ?? '-'}`,
    );
    if (walletId && account.isConnected) {
      updateSavedWallet(walletId, { address: account.address, chainId: account.chainId });
      // The selection is the user's: a wallet connecting does not take it
      // over, except when nothing is selected yet.
      const activeId = getActiveWalletId();
      if (!activeId || !savedWallets.some((w) => w.id === activeId)) setActiveWalletId(walletId);
    }
    // The selected wallet, when connected, is the one wagmi signs with.
    const active = connectorFor(getActiveWalletId() ?? '');
    if (active && isConnected(active) && account.connector?.uid !== active.uid) {
      void switchConnection(wagmiConfig, { connector: active }).catch(() => undefined);
    }
    notify();
  },
});

// Wallets other than the current one connecting or dropping out. A wallet
// that drops out on its own had its session ended in the wallet app —
// OneKey, for one, ends an app's older connection when a new one is approved.
let connectedIds = new Set<string>();
/** Wallets this app is disconnecting itself (not worth a warning). */
const leaving = new Set<string>();
watchConnections(wagmiConfig, {
  onChange(connections) {
    const now = new Set(connections.map((c) => walletIdOf(c.connector)).filter((id): id is string => !!id));
    for (const id of connectedIds) {
      if (!now.has(id) && !leaving.delete(id)) {
        diag('warn', 'WALLET', `wallet ${id} disconnected: its session ended in the wallet app or expired`);
      }
    }
    connectedIds = now;
    // Keep each wallet's last address, so it can still be viewed offline.
    for (const c of connections) {
      const id = walletIdOf(c.connector);
      if (id && c.accounts[0]) updateSavedWallet(id, { address: c.accounts[0], chainId: c.chainId });
    }
    notify();
  },
});

/** Renew a session once less than this is left of its 7 days. */
const RENEW_BEFORE_MS = 6 * 24 * 3600_000;

/**
 * WalletConnect sessions run out after 7 days; renewing them as the app
 * starts keeps a wallet paired for as long as the app is used, with no new
 * confirmation in the wallet.
 */
async function renewSession(connector: Connector): Promise<void> {
  try {
    const provider: any = await connector.getProvider();
    const session = provider?.session;
    const client = provider?.signer?.client;
    if (!session?.topic || typeof client?.extend !== 'function') return;
    if (session.expiry * 1000 - Date.now() > RENEW_BEFORE_MS) return;
    await client.extend({ topic: session.topic });
    diag('info', 'WALLET', `session of wallet ${walletIdOf(connector)} renewed for 7 days`);
  } catch (e: any) {
    diag('warn', 'WALLET', `renewing the session of wallet ${walletIdOf(connector)} failed: ${e?.message ?? e}`);
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

/** Pairs a new wallet (QR code) and makes it the selected one. */
export async function addWallet(): Promise<WalletStatus> {
  const id = crypto.randomUUID();
  const connector = wagmiConfig._internal.connectors.setup(walletConnector(id));
  wagmiConfig._internal.connectors.setState((list) => [...list, connector]);
  diag('info', 'WALLET', `adding wallet ${id}`);
  const releaseOverlay = holdOverlay();
  try {
    const res = await connect(wagmiConfig, { connector });
    saveWallets([
      ...savedWallets,
      {
        id,
        addedAt: Date.now(),
        name: await peerName(connector),
        address: res.accounts[0],
        chainId: res.chainId,
      },
    ]);
    setActiveWalletId(id);
    diag('info', 'WALLET', `wallet ${id} added: ${formatShortAddress(res.accounts[0])}`);
  } catch (e: any) {
    diag('warn', 'WALLET', `adding wallet ${id} failed: ${e?.shortMessage ?? e?.message ?? e}`);
    await closeClient(connector);
    dropConnector(connector);
    forgetWalletConnectStorage(id);
    throw e;
  } finally {
    releaseOverlay();
    notify();
  }
  return getWalletStatus();
}

/**
 * Makes a saved wallet the one Exchange and Earn use, at once and without
 * asking the wallet. An offline one is selected to view only: its balances,
 * Earn positions and approvals show, and signing waits for `reconnectWallet`.
 */
export async function selectWallet(id: string): Promise<WalletStatus> {
  const connector = connectorFor(id);
  if (!connector) throw new Error(`Unknown wallet ${id}`);
  setActiveWalletId(id);
  if (isConnected(connector)) {
    diag('info', 'WALLET', `selecting wallet ${id}`);
    await switchConnection(wagmiConfig, { connector });
    void renewSession(connector);
  } else {
    diag('info', 'WALLET', `selecting wallet ${id} to view only (not connected)`);
  }
  notify();
  return getWalletStatus();
}

/**
 * Connects a saved wallet again so it can sign (its session ended or
 * expired): shows the QR code, and selects it.
 */
export async function reconnectWallet(id: string): Promise<WalletStatus> {
  const connector = connectorFor(id);
  if (!connector) throw new Error(`Unknown wallet ${id}`);
  diag('info', 'WALLET', `reconnecting wallet ${id}`);
  setActiveWalletId(id);
  if (!isConnected(connector)) {
    const releaseOverlay = holdOverlay();
    try {
      await connect(wagmiConfig, { connector });
    } finally {
      releaseOverlay();
    }
    updateSavedWallet(id, { name: await peerName(connector) });
  } else {
    await switchConnection(wagmiConfig, { connector });
  }
  void renewSession(connector);
  notify();
  return getWalletStatus();
}

/** Ends the wallet's session (in the wallet app too) and forgets it. */
export async function removeWallet(id: string): Promise<void> {
  const connector = connectorFor(id);
  diag('info', 'WALLET', `removing wallet ${id}`);
  leaving.add(id);
  if (connector) {
    // An offline wallet never confirms, so do not wait for it forever.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('wallet did not answer')), 5000),
    );
    await Promise.race([disconnect(wagmiConfig, { connector }), timeout]).catch((e) => {
      diag('warn', 'WALLET', `ending the session of wallet ${id} failed, removing it anyway: ${e?.message ?? e}`);
    });
    await closeClient(connector);
    dropConnector(connector);
  }
  forgetWalletConnectStorage(id);
  saveWallets(savedWallets.filter((w) => w.id !== id));
  if (getActiveWalletId() === id) {
    setActiveWalletId(walletIdOf(getAccount(wagmiConfig).connector) ?? savedWallets[0]?.id);
  }
  notify();
}

/** Uses the selected wallet, reconnecting it if needed; pairs one if there is none. */
export async function connectWallet(): Promise<WalletStatus> {
  const current = getWalletStatus();
  if (current.isConnected) return current;
  const id = getActiveWalletId() ?? savedWallets[0]?.id;
  if (id && connectorFor(id)) return reconnectWallet(id);
  return addWallet();
}

/** Removes the wallet in use. */
export async function disconnectWallet(): Promise<void> {
  const id = walletIdOf(getAccount(wagmiConfig).connector) ?? getActiveWalletId();
  if (id) await removeWallet(id);
}

// Restore the saved sessions, then put the selected wallet back in front:
// reconnect() makes whichever it restores first the current one. A selected
// wallet that did not come back stays selected, to view only.
const selectedAtStart = getActiveWalletId();
reconnect(wagmiConfig)
  .then(async (connections) => {
    diag('info', 'WALLET', `restored ${connections.length} of ${savedWallets.length} wallets`);
    connections.forEach((c) => void renewSession(c.connector));
    const connector = selectedAtStart ? connectorFor(selectedAtStart) : undefined;
    if (connector && isConnected(connector) && getAccount(wagmiConfig).connector?.uid !== connector.uid) {
      await switchConnection(wagmiConfig, { connector });
    }
    notify();
  })
  .catch((e) => {
    diag('error', 'WALLET', `restoring wallets failed: ${e?.message ?? e}`);
  });

import { createConfig, http } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { mainnet, arbitrum, optimism, polygon, bsc, base, avalanche, katana } from 'viem/chains';
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

export const PROJECT_ID = '927c5d6fc3d30f43842ac0b9e0714891';

export const defaultMetadata = {
  name: 'CoinMan Portfolio Tracker',
  description: 'Cross-Chain Crypto Exchange & Portfolio',
  url: 'https://coinman.dev',
  icons: ['https://coinman.dev/images/coinman.dev.webp'],
};

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
  chains: [mainnet, arbitrum, optimism, polygon, bsc, base, avalanche, katana],
  connectors: savedWallets.map((w) => walletConnector(w.id)),
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
    [base.id]: http(),
    [avalanche.id]: http(),
    [katana.id]: http(),
  },
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

export interface WalletStatus {
  isConnected: boolean;
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
  const walletId = walletIdOf(acc.connector);
  return {
    isConnected: !!acc.isConnected && !!acc.address,
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
    // Whatever wagmi uses is the selected wallet; it moves on by itself when
    // the selected one disconnects.
    if (walletId && account.isConnected) {
      setActiveWalletId(walletId);
      updateSavedWallet(walletId, { address: account.address, chainId: account.chainId });
    }
    notify();
  },
});

// Wallets other than the current one connecting or dropping out.
watchConnections(wagmiConfig, { onChange: notify });

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
 * Makes a saved wallet the one Exchange and Earn use. An offline wallet is
 * reconnected first; if its session has expired that shows the QR code.
 */
export async function selectWallet(id: string): Promise<WalletStatus> {
  const connector = connectorFor(id);
  if (!connector) throw new Error(`Unknown wallet ${id}`);
  diag('info', 'WALLET', `selecting wallet ${id}`);
  if (isConnected(connector)) {
    await switchConnection(wagmiConfig, { connector });
  } else {
    // An expired session shows the QR code again.
    const releaseOverlay = holdOverlay();
    try {
      await connect(wagmiConfig, { connector });
    } finally {
      releaseOverlay();
    }
    updateSavedWallet(id, { name: await peerName(connector) });
  }
  setActiveWalletId(id);
  notify();
  return getWalletStatus();
}

/** Ends the wallet's session (in the wallet app too) and forgets it. */
export async function removeWallet(id: string): Promise<void> {
  const connector = connectorFor(id);
  diag('info', 'WALLET', `removing wallet ${id}`);
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
  if (id && connectorFor(id)) return selectWallet(id);
  return addWallet();
}

/** Removes the wallet in use. */
export async function disconnectWallet(): Promise<void> {
  const id = walletIdOf(getAccount(wagmiConfig).connector) ?? getActiveWalletId();
  if (id) await removeWallet(id);
}

// Restore the saved sessions, then put the selected wallet back in front:
// reconnect() makes whichever it restores first the current one (and the
// account watcher above records that as selected, hence reading it first).
const selectedAtStart = getActiveWalletId();
reconnect(wagmiConfig)
  .then(async (connections) => {
    diag('info', 'WALLET', `restored ${connections.length} of ${savedWallets.length} wallets`);
    const connector = selectedAtStart ? connectorFor(selectedAtStart) : undefined;
    if (connector && isConnected(connector) && getAccount(wagmiConfig).connector?.uid !== connector.uid) {
      await switchConnection(wagmiConfig, { connector });
    }
    notify();
  })
  .catch((e) => {
    diag('error', 'WALLET', `restoring wallets failed: ${e?.message ?? e}`);
  });

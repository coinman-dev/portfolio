import { WalletConnectAdapter } from '@tronweb3/tronwallet-adapter-walletconnect';
import UniversalProvider from '@walletconnect/universal-provider';
import { PROJECT_ID, defaultMetadata } from './wallet';
import { walletConnectStorage } from './store';
import { PairingCancelled, explainDeclinedPairing, pairWithQr } from './qr';
import { diag } from '../diag';

/**
 * The one Tron wallet connection (WalletConnect), shared by the LI.FI widget
 * and Approvals, so connecting in one place connects both. It is a pairing
 * of its own: OneKey offers only EVM networks over WalletConnect, so Tron
 * needs a wallet that supports it. Extension wallets (TronLink, OKX…)
 * cannot live in this webview.
 *
 * Always connect through `connectTron`: called without a URI handler the
 * adapter opens a Reown AppKit window of its own, and a second AppKit on
 * the page breaks the EVM wallet's QR window.
 */

const STORAGE_ID = 'tron';

export const tronAdapter = new WalletConnectAdapter({
  network: 'Mainnet',
  options: { projectId: PROJECT_ID, metadata: defaultMetadata, customStoragePrefix: STORAGE_ID },
  themeMode: 'dark',
  themeVariables: { '--w3m-z-index': 10001 },
  enableAnalytics: false,
});

type Listener = (address: string | null) => void;
const listeners = new Set<Listener>();

function notify(): void {
  const address = tronAdapter.connected ? tronAdapter.address : null;
  listeners.forEach((listener) => listener(address));
}

tronAdapter.on('connect', notify);
tronAdapter.on('disconnect', notify);
tronAdapter.on('accountsChanged', notify);

/**
 * The adapter's WalletConnect client keeps its session in the webview's
 * storage, which the app wipes on exit. This one keeps it in
 * data/wallets.json like the other wallets, so Tron stays paired across
 * restarts. It is handed to the adapter before its first use.
 */
let walletPromise: Promise<any> | null = null;

function persistentWallet(): Promise<any> {
  if (!walletPromise) {
    walletPromise = (async () => {
      const { WalletConnectWallet, WalletConnectChainID } = (await import('@tronweb3/walletconnect-tron')) as any;
      class PersistentTronWallet extends WalletConnectWallet {
        async getProvider() {
          const self = this as any;
          if (self.provider) return self.provider;
          self.providerPromise ??= UniversalProvider.init({
            projectId: PROJECT_ID,
            metadata: defaultMetadata,
            customStoragePrefix: STORAGE_ID,
            storage: walletConnectStorage(STORAGE_ID) as any,
          }).catch((err: unknown) => {
            self.providerPromise = null;
            throw err;
          });
          self.provider = await self.providerPromise;
          self._client = self.provider.client;
          return self.provider;
        }
      }
      const adapter = tronAdapter as any;
      if (!adapter._wallet) {
        adapter._wallet = new (PersistentTronWallet as any)({ ...adapter._config, network: WalletConnectChainID.Mainnet });
      }
      return adapter._wallet;
    })();
    walletPromise.catch(() => {
      walletPromise = null;
    });
  }
  return walletPromise;
}

/** Renew a session once less than this is left of its 7 days. */
const RENEW_BEFORE_MS = 6 * 24 * 3600_000;

/** Puts back a Tron session saved at an earlier run, without asking the wallet. */
let restoring: Promise<void> | null = null;
function restoreTron(): Promise<void> {
  restoring ??= (async () => {
    try {
      const wallet = await persistentWallet();
      const provider = await wallet.getProvider();
      const session = provider.client.session
        .getAll()
        .filter((s: any) => s.acknowledged && s.namespaces?.tron)
        .pop();
      if (!session || tronAdapter.connected) return;
      // With a session in storage the adapter reuses it: no QR code, no prompt.
      await tronAdapter.connect();
      diag('info', 'WALLET', 'Tron wallet restored');
      if (session.expiry * 1000 - Date.now() < RENEW_BEFORE_MS) {
        await provider.client.extend({ topic: session.topic }).catch(() => undefined);
      }
    } catch (err: any) {
      diag('warn', 'WALLET', `Tron wallet could not be restored: ${err?.message ?? err}`);
    }
  })();
  return restoring;
}

/** Called with the connected Tron address (null when none) now and on every change. */
export function subscribeTron(listener: Listener): () => void {
  listeners.add(listener);
  listener(tronAdapter.connected ? tronAdapter.address : null);
  void restoreTron();
  return () => {
    listeners.delete(listener);
  };
}

/** Shows the WalletConnect QR code unless a Tron wallet is already connected. */
export async function connectTron(): Promise<string> {
  await restoreTron();
  if (!tronAdapter.connected) {
    await persistentWallet();
    try {
      await pairWithQr(
        (showUri) => tronAdapter.connect({ onUri: showUri }),
        // Drops the half-open pairing, so the next attempt starts afresh.
        () => void tronAdapter.disconnect().catch(() => undefined)
      );
    } catch (err) {
      if (err instanceof PairingCancelled) throw err;
      throw explainDeclinedPairing('Tron', err);
    }
  }
  if (!tronAdapter.address) throw new Error('The Tron wallet did not share an address.');
  return tronAdapter.address;
}

export async function disconnectTron(): Promise<void> {
  await tronAdapter.disconnect();
}

import UniversalProvider from '@walletconnect/universal-provider';
import { PROJECT_ID, defaultMetadata } from './wallet';
import { walletConnectStorage } from './store';
import { PairingCancelled, explainDeclinedPairing, pairWithQr } from './qr';
import { diag } from '../diag';

/**
 * The Solana wallet connection: a WalletConnect pairing of its own (OneKey
 * offers only EVM networks over WalletConnect, so Solana needs a wallet that
 * supports it), kept in data/wallets.json like the others so it survives a
 * restart.
 */

/** Solana mainnet as WalletConnect names it; some wallets still use the older id. */
const SOLANA_CHAINS = ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ'];
/** Only transaction signing is asked for: no messages, no send-on-our-behalf. */
const METHODS = ['solana_signTransaction'];
const STORAGE_ID = 'solana';
/** Renew a session once less than this is left of its 7 days. */
const RENEW_BEFORE_MS = 6 * 24 * 3600_000;

let providerPromise: Promise<UniversalProvider> | null = null;

type Listener = (address: string | null) => void;
const listeners = new Set<Listener>();
let lastProvider: UniversalProvider | null = null;

function accountOf(provider: UniversalProvider | null): { chain: string; address: string } | null {
  const account = provider?.session?.namespaces?.solana?.accounts?.[0];
  if (!account) return null;
  const parts = account.split(':');
  return parts.length === 3 ? { chain: `${parts[0]}:${parts[1]}`, address: parts[2] } : null;
}

function notify(): void {
  const address = accountOf(lastProvider)?.address ?? null;
  listeners.forEach((listener) => listener(address));
}

function getProvider(): Promise<UniversalProvider> {
  if (!providerPromise) {
    providerPromise = UniversalProvider.init({
      projectId: PROJECT_ID,
      metadata: defaultMetadata,
      customStoragePrefix: STORAGE_ID,
      storage: walletConnectStorage(STORAGE_ID) as any,
    }).then((provider) => {
      lastProvider = provider;
      provider.on('session_delete', () => {
        diag('info', 'WALLET', 'Solana wallet session ended by the wallet');
        notify();
      });
      provider.on('session_update', notify);
      // Sessions run out after 7 days; renewing at start keeps the wallet paired.
      const session = provider.session;
      if (session && session.expiry * 1000 - Date.now() < RENEW_BEFORE_MS) {
        void provider.client.extend({ topic: session.topic }).catch(() => undefined);
      }
      notify();
      return provider;
    });
    providerPromise.catch((err) => {
      diag('error', 'WALLET', `Solana WalletConnect could not start: ${err?.message ?? err}`);
      providerPromise = null;
    });
  }
  return providerPromise;
}

/** Called with the connected Solana address (null when none) now and on every change. */
export function subscribeSolana(listener: Listener): () => void {
  listeners.add(listener);
  listener(accountOf(lastProvider)?.address ?? null);
  // Restores a saved session; the listener hears about it once it is back.
  void getProvider().catch(() => undefined);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows the WalletConnect QR code unless a Solana wallet is already connected. */
export async function connectSolana(): Promise<string> {
  const provider = await getProvider();
  const current = accountOf(provider);
  if (current) return current.address;

  let showUri: (uri: string) => void = () => {};
  const onUri = (uri: string) => showUri(uri);
  provider.on('display_uri', onUri);
  try {
    await pairWithQr(
      (show) => {
        showUri = show;
        return provider.connect({ optionalNamespaces: { solana: { chains: SOLANA_CHAINS, methods: METHODS, events: [] } } });
      },
      () => provider.abortPairingAttempt?.()
    );
  } catch (err) {
    if (err instanceof PairingCancelled) throw err;
    throw explainDeclinedPairing('Solana', err);
  } finally {
    provider.off('display_uri', onUri);
    notify();
  }
  const account = accountOf(provider);
  if (!account) throw new Error('The wallet did not share a Solana account.');
  diag('info', 'WALLET', `Solana wallet connected: ${account.address.slice(0, 6)}…`);
  return account.address;
}

export async function disconnectSolana(): Promise<void> {
  const provider = await getProvider();
  if (provider.session) await provider.disconnect().catch(() => undefined);
  notify();
}

/** What the wallet returns: the signature, and with some wallets the whole signed transaction. */
export interface SolanaSignResult {
  signature?: string;
  transaction?: string;
}

/**
 * Asks the wallet to sign a serialized transaction. The legacy fields go
 * along for wallets that predate the `transaction` parameter.
 */
export async function signSolanaTransaction(
  transactionBase64: string,
  legacy: { feePayer: string; recentBlockhash: string; instructions: unknown[] }
): Promise<SolanaSignResult> {
  const provider = await getProvider();
  const account = accountOf(provider);
  if (!account) throw new Error('No Solana wallet is connected.');
  return provider.request<SolanaSignResult>(
    {
      method: 'solana_signTransaction',
      params: { transaction: transactionBase64, pubkey: account.address, ...legacy },
    },
    account.chain
  );
}

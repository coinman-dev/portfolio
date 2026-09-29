import {
  Adapter,
  AdapterState,
  WalletReadyState,
  type AdapterName,
  type SignedTransaction,
  type Transaction,
} from '@tronweb3/tronwallet-abstract-adapter';
import { getWalletStatus, sessionProperty, shareAllNetworks, subscribeWalletStatus, walletRequest } from './wallet';

/**
 * The Tron account of the selected wallet, as a Tron wallet adapter the
 * LI.FI widget and Approvals both use. It rides on the wallet's one
 * WalletConnect session (see wallet.ts): OneKey keeps a single connection
 * per app, so a separate Tron pairing would log the EVM wallet out, and it
 * would not survive a restart either.
 */

const ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#3b99fc"/>' +
      '<path d="M19 27c7-7 19-7 26 0l-3 3c-5-5-15-5-20 0zm-4 4 4-4 8 8 5-5 5 5 8-8 4 4-12 12-5-5-5 5z" fill="#fff"/></svg>'
  );

class SessionTronAdapter extends Adapter {
  name = 'WalletConnect' as AdapterName;
  url = 'https://walletconnect.network';
  icon = ICON;
  readyState = WalletReadyState.Found;
  connecting = false;
  private _state = AdapterState.Disconnect;
  private _address: string | null = null;

  constructor() {
    super();
    subscribeWalletStatus((status) => this.follow(status.tronAddress ?? null));
  }

  get state(): AdapterState {
    return this._state;
  }

  get address(): string | null {
    return this._address;
  }

  /** Mirrors the session: the wallet shares, changes or drops its Tron account. */
  private follow(next: string | null): void {
    const previous = this._address;
    if (next === previous) return;
    this._address = next;
    if (next && !previous) {
      this._state = AdapterState.Connected;
      this.emit('connect', next);
      this.emit('stateChanged', this._state);
    } else if (!next && previous) {
      this._state = AdapterState.Disconnect;
      this.emit('disconnect');
      this.emit('stateChanged', this._state);
    } else if (next && previous) {
      this.emit('accountsChanged', next, previous);
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connecting = true;
    try {
      await connectTron();
    } finally {
      this.connecting = false;
    }
  }

  /** Nothing to end on its own: Tron lives in the wallet's session (remove the wallet to end it). */
  async disconnect(): Promise<void> {}

  async signMessage(): Promise<string> {
    throw new Error('Message signing is off in CoinMan.');
  }

  async signTransaction(transaction: Transaction): Promise<SignedTransaction> {
    const address = this._address;
    if (!address) throw new Error('No Tron account is connected.');
    // Wallets on the older WalletConnect Tron spec take the bare transaction.
    const params =
      sessionProperty('tron_method_version') === 'v1'
        ? { address, transaction }
        : { address, transaction: { transaction } };
    const result: any = await walletRequest('tron', 'tron_signTransaction', params);
    return (result?.result ?? result) as SignedTransaction;
  }
}

export const tronAdapter = new SessionTronAdapter();

type Listener = (address: string | null) => void;

/** Called with the Tron address (null when none) now and on every change. */
export function subscribeTron(listener: Listener): () => void {
  return subscribeWalletStatus((status) => listener(status.tronAddress ?? null));
}

/**
 * The selected wallet's Tron account; if its session does not include one
 * yet, the wallet is asked once to share it (together with Solana).
 */
export async function connectTron(): Promise<string> {
  const current = getWalletStatus().tronAddress;
  if (current) return current;
  const next = await shareAllNetworks();
  if (!next.tronAddress) throw new Error('The wallet did not share a Tron account.');
  return next.tronAddress;
}

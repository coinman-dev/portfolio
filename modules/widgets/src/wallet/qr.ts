import { WalletConnectModal } from '@walletconnect/modal';
import { PROJECT_ID } from './wallet';
import { holdOverlay } from './overlay';

/**
 * The QR window for Tron and Solana pairings. The EVM connection keeps the
 * window its own provider brings (Reown AppKit); a second AppKit on the page
 * takes over that window's elements and leaves the EVM QR code blank, so the
 * other wallets use this separate, lighter one.
 */

let modal: WalletConnectModal | null = null;

function qrModal(): WalletConnectModal {
  modal ??= new WalletConnectModal({
    projectId: PROJECT_ID,
    themeMode: 'dark',
    themeVariables: { '--wcm-z-index': '10001' },
  });
  return modal;
}

export class PairingCancelled extends Error {
  constructor() {
    super('Connection cancelled');
  }
}

/**
 * Runs a pairing: `start` gets a function to call with the WalletConnect
 * URI, which shows the QR code. Closing the window cancels (`onCancel`
 * cleans up the half-open pairing) and rejects with PairingCancelled.
 */
export async function pairWithQr<T>(
  start: (showUri: (uri: string) => void) => Promise<T>,
  onCancel: () => void
): Promise<T> {
  const qr = qrModal();
  const release = holdOverlay();
  let unsubscribe = () => {};
  let opened = false;
  try {
    const closed = new Promise<never>((_, reject) => {
      unsubscribe = qr.subscribeModal((state) => {
        if (state.open) opened = true;
        else if (opened) reject(new PairingCancelled());
      });
    });
    return await Promise.race([start((uri) => void qr.openModal({ uri })), closed]);
  } catch (err) {
    if (err instanceof PairingCancelled) onCancel();
    throw err;
  } finally {
    unsubscribe();
    qr.closeModal();
    release();
  }
}

/**
 * Plain words for a wallet that turned a Tron or Solana pairing down. OneKey
 * does: over WalletConnect it offers EVM (and Algorand) only.
 */
export function explainDeclinedPairing(family: 'Tron' | 'Solana', err: any): Error {
  const text = String(err?.message ?? err);
  if (/reject|declin|not supported|unsupported/i.test(text)) {
    return new Error(
      `The wallet declined the ${family} connection. OneKey offers only EVM networks over WalletConnect — ` +
        `for ${family}, scan the code with a wallet that supports it (e.g. Trust Wallet, TokenPocket, SafePal, Bitget).`
    );
  }
  return err instanceof Error ? err : new Error(text);
}

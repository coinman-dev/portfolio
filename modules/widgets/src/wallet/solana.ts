import { getWalletStatus, shareAllNetworks, subscribeWalletStatus, walletRequest } from './wallet';

/**
 * The Solana account of the selected wallet. It comes from the same
 * WalletConnect session as the EVM account (see wallet.ts: OneKey keeps
 * one connection per app, so a separate Solana pairing would log the EVM
 * wallet out).
 */

type Listener = (address: string | null) => void;

/** Called with the Solana address (null when none) now and on every change. */
export function subscribeSolana(listener: Listener): () => void {
  return subscribeWalletStatus((status) => listener(status.solanaAddress ?? null));
}

/**
 * The selected wallet's Solana account; if its session does not include
 * one yet, the wallet is asked once to share it (together with Tron).
 */
export async function connectSolana(): Promise<string> {
  const current = getWalletStatus().solanaAddress;
  if (current) return current;
  const next = await shareAllNetworks();
  if (!next.solanaAddress) throw new Error('The wallet did not share a Solana account.');
  return next.solanaAddress;
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
  const pubkey = getWalletStatus().solanaAddress;
  if (!pubkey) throw new Error('No Solana account is connected.');
  return walletRequest<SolanaSignResult>('solana', 'solana_signTransaction', {
    transaction: transactionBase64,
    pubkey,
    ...legacy,
  });
}

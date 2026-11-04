import { isAddress } from 'viem';
import { BrChain, ChainType } from './types';
import { tr } from './i18n';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export const formatUSD = (value: number) => (Number.isFinite(value) ? usd.format(value) : '—');

/** Token amounts: up to 6 significant decimals, grouped thousands. */
export function formatAmount(amount: bigint, decimals: number): string {
  const value = Number(amount) / 10 ** decimals;
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatPct(value: number | null): string {
  if (value == null) return tr('not disclosed');
  if (value === 0) return '0%';
  return `${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}%`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return tr('{n} s', { n: Math.round(seconds) });
  if (seconds < 3600) return tr('{n} min', { n: Math.round(seconds / 60) });
  return tr('{n} h', { n: (seconds / 3600).toFixed(1) });
}

export const shortAddress = (address: string) =>
  address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

const ADDRESS_PATTERNS: Record<ChainType, RegExp> = {
  EVM: /^0x[0-9a-fA-F]{40}$/,
  TVM: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  SVM: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  UTXO: /^(bc1[0-9a-z]{25,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  MVM: /^0x[0-9a-fA-F]{64}$/,
};

/** UTXO chains each have their own format; the family pattern above is Bitcoin's. */
const UTXO_PATTERNS: Record<string, RegExp> = {
  btc: ADDRESS_PATTERNS.UTXO,
  // Transparent addresses only: the swap services cannot pay shielded ones.
  zec: /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/,
  dash: /^[X7][1-9A-HJ-NP-Za-km-z]{33}$/,
  ltc: /^(ltc1[0-9a-z]{25,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  doge: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/,
  // CashAddr without the "bitcoincash:" prefix (its colon would break a memo), or legacy.
  bch: /^([qp][0-9a-z]{41}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
};

/**
 * Which typed-in address a chain uses: one per family, except UTXO chains,
 * where Bitcoin, Zcash and Dash addresses differ.
 */
export const addressKey = (chain: BrChain): string =>
  chain.type === 'UTXO' && UTXO_PATTERNS[chain.key] ? chain.key : chain.type;

/** Format check; mixed-case EVM addresses must also match their checksum, which catches typos. */
export function isAddressFor(chain: BrChain, address: string): boolean {
  const value = address.trim();
  if (chain.type === 'EVM') return isAddress(value);
  return (UTXO_PATTERNS[addressKey(chain)] ?? ADDRESS_PATTERNS[chain.type]).test(value);
}

export const FAMILY_NAMES: Record<ChainType, string> = {
  EVM: 'EVM',
  TVM: 'Tron',
  SVM: 'Solana',
  UTXO: 'Bitcoin',
  MVM: 'Sui',
};

/** "Dash address", "Solana address": UTXO chains by their own name. */
export const addressName = (chain: BrChain) =>
  chain.type === 'UTXO' ? chain.name : FAMILY_NAMES[chain.type];

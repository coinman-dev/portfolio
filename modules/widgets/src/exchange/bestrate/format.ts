import { ChainType } from './types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export const formatUSD = (value: number) => (Number.isFinite(value) ? usd.format(value) : '—');

/** Token amounts: up to 6 significant decimals, grouped thousands. */
export function formatAmount(amount: bigint, decimals: number): string {
  const value = Number(amount) / 10 ** decimals;
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatPct(value: number | null): string {
  if (value == null) return 'not disclosed';
  if (value === 0) return '0%';
  return `${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}%`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
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

export const isAddressFor = (type: ChainType, address: string) => ADDRESS_PATTERNS[type].test(address.trim());

export const FAMILY_NAMES: Record<ChainType, string> = {
  EVM: 'EVM',
  TVM: 'Tron',
  SVM: 'Solana',
  UTXO: 'Bitcoin',
  MVM: 'Sui',
};

import { sha256 } from 'viem';

/** Base58 (Bitcoin alphabet), used by Tron and Solana addresses and Solana signatures. */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let text = '';
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    text = '1' + text;
  }
  return text;
}

export function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('not base58');
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error('not hex');
  return Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

const checksum = (payload: Uint8Array) => sha256(sha256(payload, 'bytes'), 'bytes').slice(0, 4);

/** Tron base58check address → `41` + 20 bytes, lowercase hex (no 0x). Throws on a bad checksum. */
export function tronToHex(address: string): string {
  const raw = base58Decode(address);
  if (raw.length !== 25 || raw[0] !== 0x41) throw new Error(`not a Tron address: ${address}`);
  const sum = checksum(raw.slice(0, 21));
  if (sum.some((b, i) => b !== raw[21 + i])) throw new Error(`bad Tron address checksum: ${address}`);
  return bytesToHex(raw.slice(0, 21));
}

/** `41…` hex (with or without 0x, or a bare 20-byte EVM form) → Tron base58check address. */
export function hexToTron(hex: string): string {
  let clean = hex.toLowerCase().replace(/^0x/, '');
  if (clean.length === 40) clean = `41${clean}`;
  const payload = hexToBytes(clean);
  if (payload.length !== 21 || payload[0] !== 0x41) throw new Error(`not a Tron hex address: ${hex}`);
  const out = new Uint8Array(25);
  out.set(payload);
  out.set(checksum(payload), 21);
  return base58Encode(out);
}

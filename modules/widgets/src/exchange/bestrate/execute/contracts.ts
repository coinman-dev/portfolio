import { ProviderId } from '../types';
import { lifiDiamond } from '../../lifiGuard';

/**
 * The only contracts a Best Rate transaction may call, or approve, per
 * service — taken from each service's own documentation (checked
 * 2026-09-29). A quote pointing anywhere else is refused before the wallet
 * sees it.
 */

// Relay: depository (deposits), approval proxy and router (swaps), receiver.
// https://docs.relay.link/references/protocol/addresses, api.relay.link/chains
const RELAY_DEPOSITORY_ALT = '0x59916da825d2d2ec1bf878d71c88826f6633ecca';
const RELAY_DEPOSITORY_ALT_CHAINS = new Set([25, 1088, 5000, 59144]);
const RELAY_COMMON = [
  '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be', // ApprovalProxy
  '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f', // ERC20Router
];
const relayContracts = (chainId: number) => [
  RELAY_DEPOSITORY_ALT_CHAINS.has(chainId) ? RELAY_DEPOSITORY_ALT : '0x4cd00e387622c35bddb9b4c962c136462338bc31',
  ...RELAY_COMMON,
  chainId === 747474 ? '0x9ff28846cd0640ba4aac04d3ebbe651cac5fe609' : '0xa5f565650890fba1824ee0f21ebbbf660a179934',
];

// Socket: Allowance Holder and Open Router, same on every EVM chain.
// https://docs.socket.tech/about/chain-support
const SOCKET = ['0x50c4e75a512f2a14a7b304787adf79c4531a5909', '0x50cfe7c1938db66a1a6d2e86d36f39fbef3d5c4a'];

// KyberSwap: MetaAggregationRouterV2 and KSAggregationRouterV3.
// https://docs.kyberswap.com/developer-guide/aggregator-api/contracts
const KYBER = ['0x6131b5fae19ea4f9d964eac0408e4408b66337b5', '0x6868d319c8c9a78f7d39dc3602c5c917315132d7'];

// deBridge: DlnSource only. Orders placed through DeBridgeRouter (a swap
// first) cannot be checked field by field, so they go to the site instead.
// https://docs.debridge.com/dln-details/overview/deployed-contracts
export const DLN_SOURCE = '0xef4fb24ad0916217251f553c0596f8edc630eb66';

export function allowedContracts(provider: ProviderId, chainId: number): Set<string> {
  switch (provider) {
    case 'relay':
      return new Set(relayContracts(chainId));
    case 'socket':
      return new Set(SOCKET);
    case 'kyberswap':
      return new Set(KYBER);
    case 'debridge':
      return new Set([DLN_SOURCE]);
    case 'lifi': {
      const diamond = lifiDiamond(chainId);
      return new Set(diamond ? [diamond] : []);
    }
    default:
      return new Set();
  }
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new Error('bad base58');
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

const hex = (bytes: Uint8Array) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;

/**
 * How a receiver address is written inside a cross-chain order: 20 bytes for
 * EVM and Tron (without Tron's 0x41 prefix), 32 bytes for Solana.
 */
export function receiverBytes(address: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return address.toLowerCase();
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    const raw = base58Decode(address); // 0x41 + 20 bytes + 4-byte checksum
    return hex(raw.slice(1, 21));
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return hex(base58Decode(address));
  throw new Error(`unsupported address ${address}`);
}

import { createPublicClient, fallback, http, type Chain, type PublicClient } from 'viem';
import { WALLET_CHAINS } from '../../wallet/chains';

/**
 * Where each network's approval history comes from.
 *
 * With a HyperSync key (envio.dev, free) every network is read from
 * HyperSync. Without one, the keyless sources below are tried in order; each
 * was checked on 2026-09-29 to return an owner's events over the whole
 * history in one query. BNB Chain, Linea, Mantle and Blast have none — their
 * public RPCs cap log queries at 10 000 blocks or refuse them. Blockscout's
 * free Ethereum API allows only ~10 requests before a long pause, so it is
 * the fallback there. optimism.blockscout.com is left out on purpose: Avast
 * blocks it as malicious, so Optimism goes to its official RPC.
 */
export type EventSource = { kind: 'blockscout'; host: string } | { kind: 'rpc'; url: string };

interface Sources {
  /** Keyless history sources, tried in order. */
  events?: EventSource[];
  /** Blockscout instance for contract names, verification and scam flags. */
  blockscout?: string;
  /** Preferred RPC for reads (the chain's default is the fallback). */
  rpc?: string;
}

const rpc = (url: string): EventSource => ({ kind: 'rpc', url });
const blockscout = (host: string): EventSource => ({ kind: 'blockscout', host });

const SOURCES: Record<number, Sources> = {
  1: {
    events: [rpc('https://rpc.mevblocker.io'), blockscout('eth.blockscout.com')],
    blockscout: 'eth.blockscout.com',
    rpc: 'https://ethereum-rpc.publicnode.com',
  },
  10: { events: [rpc('https://mainnet.optimism.io')] },
  56: { rpc: 'https://bsc-rpc.publicnode.com' },
  100: { events: [rpc('https://rpc.gnosischain.com')] },
  130: { events: [blockscout('unichain.blockscout.com')], blockscout: 'unichain.blockscout.com' },
  137: {
    events: [blockscout('polygon.blockscout.com'), rpc('https://gateway.tenderly.co/public/polygon')],
    blockscout: 'polygon.blockscout.com',
    rpc: 'https://polygon-bor-rpc.publicnode.com',
  },
  146: { events: [rpc('https://rpc.soniclabs.com')] },
  324: { events: [rpc('https://mainnet.era.zksync.io')], blockscout: 'zksync.blockscout.com' },
  5000: {},
  8453: { events: [blockscout('base.blockscout.com')], blockscout: 'base.blockscout.com' },
  42161: { events: [rpc('https://arb1.arbitrum.io/rpc')], blockscout: 'arbitrum.blockscout.com' },
  43114: {
    events: [rpc('https://api.avax.network/ext/bc/C/rpc')],
    rpc: 'https://avalanche-c-chain-rpc.publicnode.com',
  },
  59144: {},
  81457: {},
  534352: { events: [rpc('https://rpc.scroll.io')] },
  747474: { events: [rpc('https://rpc.katana.network')] },
};

export interface EvmScanChain {
  chain: Chain;
  id: number;
  name: string;
  nativeSymbol: string;
  explorer: string;
  /** Keyless history sources, tried in order; none = needs a HyperSync key. */
  events: EventSource[];
  blockscout?: string;
}

export const EVM_SCAN_CHAINS: EvmScanChain[] = WALLET_CHAINS.map((chain) => ({
  chain,
  id: chain.id,
  name: chain.name,
  nativeSymbol: chain.nativeCurrency.symbol,
  explorer: (chain.blockExplorers?.default.url ?? '').replace(/\/+$/, ''),
  events: SOURCES[chain.id]?.events ?? [],
  blockscout: SOURCES[chain.id]?.blockscout,
}));

export const TRON_CHAIN_ID = 728126428;
export const SOLANA_CHAIN_ID = 1151111081099710;
export const TRON_EXPLORER = 'https://tronscan.org/#';
export const SOLANA_EXPLORER = 'https://solscan.io';

const clients = new Map<number, PublicClient>();

/** Read-only client for a wallet network: the preferred RPC first, the chain's default after. */
export function readClient(chainId: number): PublicClient {
  let client = clients.get(chainId);
  if (!client) {
    const chain = WALLET_CHAINS.find((c) => c.id === chainId);
    if (!chain) throw new Error(`Network ${chainId} is not a wallet network`);
    const preferred = SOURCES[chainId]?.rpc;
    const options = { timeout: 30_000, retryCount: 1 };
    client = createPublicClient({
      chain,
      transport: preferred ? fallback([http(preferred, options), http(undefined, options)]) : http(undefined, options),
    }) as PublicClient;
    clients.set(chainId, client);
  }
  return client;
}

/** Address page on the network's explorer. */
export function addressUrl(family: 'EVM' | 'TVM' | 'SVM', chainId: number, address: string): string {
  if (family === 'TVM') return `${TRON_EXPLORER}/address/${address}`;
  if (family === 'SVM') return `${SOLANA_EXPLORER}/account/${address}`;
  const explorer = EVM_SCAN_CHAINS.find((c) => c.id === chainId)?.explorer;
  return explorer ? `${explorer}/address/${address}` : '';
}

/** Transaction page on the network's explorer. */
export function txUrl(family: 'EVM' | 'TVM' | 'SVM', chainId: number, hash: string): string {
  if (family === 'TVM') return `${TRON_EXPLORER}/transaction/${hash}`;
  if (family === 'SVM') return `${SOLANA_EXPLORER}/tx/${hash}`;
  const explorer = EVM_SCAN_CHAINS.find((c) => c.id === chainId)?.explorer;
  return explorer ? `${explorer}/tx/${hash}` : '';
}

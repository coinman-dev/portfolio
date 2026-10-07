import {
  arbitrum,
  avalanche,
  base,
  blast,
  bsc,
  gnosis,
  katana,
  linea,
  mainnet,
  mantle,
  optimism,
  polygon,
  scroll,
  sonic,
  unichain,
  zksync,
} from 'viem/chains';

/**
 * EVM networks the connected wallet can sign on. The wallet connection,
 * Best Rate and Approvals all use this list; a WalletConnect session made
 * before a network was added here must be reconnected to approve it.
 */
export const WALLET_CHAINS = [
  mainnet,
  arbitrum,
  optimism,
  polygon,
  bsc,
  base,
  avalanche,
  katana,
  gnosis,
  linea,
  sonic,
  unichain,
  zksync,
  scroll,
  mantle,
  blast,
] as const;

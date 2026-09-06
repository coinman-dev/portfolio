import { createConfig, http } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { mainnet, arbitrum, optimism, polygon, bsc, base, avalanche, katana } from 'viem/chains';
import { connect, disconnect, getAccount, reconnect, watchAccount } from '@wagmi/core';

export const PROJECT_ID = '927c5d6fc3d30f43842ac0b9e0714891';

export const defaultMetadata = {
  name: 'CoinMan Portfolio Tracker',
  description: 'Cross-Chain Crypto Exchange & Portfolio',
  url: 'https://coinman.dev',
  icons: ['https://coinman.dev/images/coinman.dev.webp'],
};

export const wcConnector = walletConnect({
  projectId: PROJECT_ID,
  metadata: defaultMetadata,
  showQrModal: true,
  qrModalOptions: {
    themeMode: 'dark',
    themeVariables: {
      '--wcm-z-index': '10001',
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [mainnet, arbitrum, optimism, polygon, bsc, base, avalanche, katana],
  connectors: [wcConnector],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
    [base.id]: http(),
    [avalanche.id]: http(),
    [katana.id]: http(),
  },
});

export interface WalletStatus {
  isConnected: boolean;
  address?: string;
  chainId?: number;
  shortAddress?: string;
}

export type WalletStatusListener = (status: WalletStatus) => void;

function formatShortAddress(addr?: string): string {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function getWalletStatus(): WalletStatus {
  const acc = getAccount(wagmiConfig);
  return {
    isConnected: !!acc.isConnected && !!acc.address,
    address: acc.address,
    chainId: acc.chainId,
    shortAddress: formatShortAddress(acc.address),
  };
}

export async function getEthereumProvider(): Promise<any> {
  const acc = getAccount(wagmiConfig);
  if (acc.isConnected && acc.connector) {
    try {
      const provider = await acc.connector.getProvider();
      return provider;
    } catch (e) {
      console.warn('[CoinmanWallet] Could not get connector provider:', e);
    }
  }
  const defaultConnector = wagmiConfig.connectors[0];
  if (defaultConnector) {
    try {
      const provider = await defaultConnector.getProvider();
      return provider;
    } catch (e) {
      return null;
    }
  }
  return null;
}

const listeners = new Set<WalletStatusListener>();

export function subscribeWalletStatus(fn: WalletStatusListener): () => void {
  listeners.add(fn);
  fn(getWalletStatus());
  return () => {
    listeners.delete(fn);
  };
}

watchAccount(wagmiConfig, {
  onChange(account) {
    const status: WalletStatus = {
      isConnected: !!account.isConnected && !!account.address,
      address: account.address,
      chainId: account.chainId,
      shortAddress: formatShortAddress(account.address),
    };
    listeners.forEach((fn) => {
      try {
        fn(status);
      } catch (e) {
        console.error('[CoinmanWallet] Error in listener:', e);
      }
    });
  },
});

export async function connectWallet(): Promise<WalletStatus> {
  const current = getWalletStatus();
  if (current.isConnected) {
    return current;
  }
  const connector = wagmiConfig.connectors[0];
  if (!connector) throw new Error('No connector configured');

  const res = await connect(wagmiConfig, { connector });
  const address = res.accounts?.[0];
  const status: WalletStatus = {
    isConnected: true,
    address,
    chainId: res.chainId,
    shortAddress: formatShortAddress(address),
  };
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch (e) {}
  });
  return status;
}

export async function disconnectWallet(): Promise<void> {
  await disconnect(wagmiConfig);
  const status: WalletStatus = {
    isConnected: false,
  };
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch (e) {}
  });
}

try {
  reconnect(wagmiConfig)
    .then(() => {
      const status = getWalletStatus();
      if (status.isConnected) {
        listeners.forEach((fn) => {
          try {
            fn(status);
          } catch (e) {}
        });
      }
    })
    .catch(() => {});
} catch (e) {}

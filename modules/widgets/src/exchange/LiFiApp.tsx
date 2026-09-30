import React, { useMemo, useEffect, useRef, useState } from 'react';
import {
  ChainId,
  ChainType,
  FormFieldChanged,
  LiFiWidget,
  WidgetConfig,
  useWidgetEvents,
  WidgetEvent,
} from '@lifi/widget';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EthereumProvider } from '@lifi/widget-provider-ethereum';
import { TronProvider } from '@lifi/widget-provider-tron';
import { EthereumProvider as EthereumSDKProvider } from '@lifi/sdk-provider-ethereum';
import { TronProvider as TronSDKProvider } from '@lifi/sdk-provider-tron';
import {
  WalletProvider as TronWalletProvider,
  useWallet as useTronWallet,
} from '@tronweb3/tronwallet-adapter-react-hooks';
import { ExchangeMountOptions } from '../types';
import { wagmiConfig } from '../wallet/wallet';
import { connectTron, subscribeTron, tronAdapter } from '../wallet/tron';
import { diag } from '../diag';
import { guardEvmClient, guardTronWallet, onGuardBlock } from './lifiGuard';

const queryClient = new QueryClient();

function shortenTronAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const isUserRejection = (err: any) =>
  err?.code === 4001 || /reject|cancel|closed|reset/i.test(String(err?.message ?? err));

/** One line per route for the diagnostic log: `12.5$ USDC (1) → DAI (42161) id=…`. */
function describeRoute(route: any): string {
  return (
    `${route?.fromAmountUSD ?? '?'}$ ${route?.fromToken?.symbol} (${route?.fromChainId}) → ` +
    `${route?.toToken?.symbol} (${route?.toChainId}) id=${route?.id}`
  );
}

function WidgetEventsHandler({ onSettingsChange }: { onSettingsChange?: (settings: any) => void }) {
  const widgetEvents = useWidgetEvents();

  useEffect(() => {
    const onExecutionStarted = (route: any) => {
      console.log('[CoinMan Exchange] Route execution started:', route);
      diag('info', 'LIFI', `route started: ${describeRoute(route)}`);
    };

    const onExecutionFailed = ({ route, action }: any) => {
      diag(
        'error',
        'LIFI',
        `route failed: ${describeRoute(route)} at ${action?.type} ${action?.status}` +
          ` tx=${action?.txHash ?? '-'}: ${action?.error?.code ?? ''} ${action?.error?.message ?? ''}`,
      );
    };

    const onExecutionCompleted = (route: any) => {
      console.log('[CoinMan Exchange] Route execution completed:', route);
      diag('info', 'LIFI', `route completed: ${describeRoute(route)}`);
      if (onSettingsChange && route?.fromToken && route?.toToken) {
        onSettingsChange({
          lastSwap: {
            fromChainId: route.fromChainId,
            toChainId: route.toChainId,
            fromTokenAddress: route.fromToken?.address,
            toTokenAddress: route.toToken?.address,
            timestamp: Date.now(),
          },
        });
      }
    };

    const onSettingUpdated = (data: any) => {
      console.log('[CoinMan Exchange] Setting updated:', data);
      if (onSettingsChange && data?.newSettings) {
        onSettingsChange({
          slippage: data.newSettings.slippage,
        });
      }
    };

    widgetEvents.on(WidgetEvent.RouteExecutionStarted, onExecutionStarted);
    widgetEvents.on(WidgetEvent.RouteExecutionFailed, onExecutionFailed);
    widgetEvents.on(WidgetEvent.RouteExecutionCompleted, onExecutionCompleted);
    widgetEvents.on(WidgetEvent.SettingUpdated, onSettingUpdated);

    return () => {
      widgetEvents.off(WidgetEvent.RouteExecutionStarted, onExecutionStarted);
      widgetEvents.off(WidgetEvent.RouteExecutionFailed, onExecutionFailed);
      widgetEvents.off(WidgetEvent.RouteExecutionCompleted, onExecutionCompleted);
      widgetEvents.off(WidgetEvent.SettingUpdated, onSettingUpdated);
    };
  }, [widgetEvents, onSettingsChange]);

  return null;
}

/** The connected Tron wallet and a way to drop it: while wallets are managed
 *  outside the widget, it hides its own wallet menu. */
function TronWalletBar() {
  const { address, connected, disconnect } = useTronWallet();
  if (!connected || !address) return null;
  return (
    <div className="coinman-tron-bar">
      <span className="coinman-tron-bar__label">Tron</span>
      <span className="coinman-tron-bar__address" title={address}>
        {shortenTronAddress(address)}
      </span>
      <button
        type="button"
        className="coinman-tron-bar__btn"
        onClick={() => void disconnect().catch(() => undefined)}
      >
        Disconnect
      </button>
    </div>
  );
}

/** Says why a transaction never reached the wallet; the widget itself only
 *  reports a generic failure. */
function GuardNotice() {
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => onGuardBlock(setReason), []);
  if (!reason) return null;
  return (
    <div className="coinman-exchange-alert" role="alert">
      <span>{`Transaction blocked: ${reason}. Nothing was sent to the wallet.`}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setReason(null)}>
        ×
      </button>
    </div>
  );
}

function LiFiExchange({ onSettingsChange }: { onSettingsChange?: (settings: any) => void }) {
  const { select } = useTronWallet();

  // The widget sees the shared Tron connection wherever it was made (here or in Approvals).
  useEffect(
    () =>
      subscribeTron((address) => {
        if (address) select(tronAdapter.name);
      }),
    [select]
  );

  // Until there is a route the widget's "Connect wallet" does not say which
  // chain it needs, so the source chain the user picked decides.
  const widgetEvents = useWidgetEvents();
  const fromChainId = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onFieldChanged = (change?: FormFieldChanged) => {
      if (change?.fieldName === 'fromChain') fromChainId.current = change.newValue as number | undefined;
    };
    widgetEvents.on(WidgetEvent.FormFieldChanged, onFieldChanged);
    return () => {
      widgetEvents.off(WidgetEvent.FormFieldChanged, onFieldChanged);
    };
  }, [widgetEvents]);

  const widgetConfig: WidgetConfig = useMemo(() => {
    return {
      integrator: 'CoinMan',
      containerStyle: {
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        width: '100%',
        maxWidth: '580px',
      },
      theme: {
        // `containerStyle` only sizes the outer box; the compact variant caps its
        // own root at 416px, so the widget itself has to be widened here too.
        container: {
          width: '100%',
          maxWidth: '580px',
        },
        palette: {
          primary: { main: '#ff8c00' },
          secondary: { main: '#ffa500' },
          background: {
            default: '#121318',
            paper: '#1a1c23',
          },
          text: {
            primary: '#ffffff',
            secondary: '#a0a5b5',
          },
        },
        shape: {
          borderRadius: 12,
          borderRadiusSecondary: 8,
        },
        typography: {
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        },
      },
      variant: 'compact',
      subvariant: 'default',
      appearance: 'dark',
      // Both providers sign through lifiGuard. Message signing stays off, so
      // every step is a plain transaction the guard can inspect.
      providers: [
        EthereumProvider({
          disableMessageSigning: true,
          sdkProvider: ({ getWalletClient, switchChain }) =>
            EthereumSDKProvider({
              getWalletClient: async () => guardEvmClient(await getWalletClient()),
              switchChain: async (chainId: number) => {
                const client = await switchChain(chainId);
                return client ? guardEvmClient(client) : client;
              },
              disableMessageSigning: true,
            }),
        }),
        TronProvider({
          sdkProvider: ({ getWallet }) =>
            TronSDKProvider({
              getWallet: async () => guardTronWallet(await getWallet()),
              multicallBatchSize: 40,
            }),
        }),
      ],
      walletConfig: {
        // EVM wallets are the app's own; Tron connects over WalletConnect here.
        onConnect(args) {
          const tron = args?.chain
            ? args.chain.chainType === ChainType.TVM
            : fromChainId.current === ChainId.TRN;
          if (tron) {
            connectTron().catch((err: any) => {
              if (!isUserRejection(err)) diag('error', 'LIFI', `Tron wallet connect failed: ${err?.message ?? err}`);
            });
          } else void (window as any).AppExchange?.handleWalletClick?.();
        },
      },
    };
  }, []);

  return (
    <div className="coinman-exchange-wrapper">
      <GuardNotice />
      <TronWalletBar />
      <div className="coinman-exchange-card">
        <WidgetEventsHandler onSettingsChange={onSettingsChange} />
        <LiFiWidget integrator="CoinMan" config={widgetConfig} />
      </div>
    </div>
  );
}

export const LiFiApp: React.FC<ExchangeMountOptions> = ({
  initialSettings: _initialSettings,
  onSettingsChange,
  onWalletConnect: _onWalletConnect,
  onWalletDisconnect: _onWalletDisconnect,
}) => {
  // Tron connects over WalletConnect only, through the connection Approvals shares.
  const [tronAdapters] = useState(() => [tronAdapter]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {/* No auto-connect: the provider would call the adapter without a
            URI handler, which opens a second AppKit window (see wallet/tron). */}
        <TronWalletProvider
          adapters={tronAdapters}
          autoConnect={false}
          onError={(err) => {
            if (!isUserRejection(err)) diag('warn', 'LIFI', `Tron wallet: ${err.message}`);
          }}
        >
          <LiFiExchange onSettingsChange={onSettingsChange} />
        </TronWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

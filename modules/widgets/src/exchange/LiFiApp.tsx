import React, { useMemo, useEffect } from 'react';
import { LiFiWidget, WidgetConfig, useWidgetEvents, WidgetEvent } from '@lifi/widget';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EthereumProvider } from '@lifi/widget-provider-ethereum';
import { ExchangeMountOptions } from '../types';
import { wagmiConfig, PROJECT_ID } from '../wallet/wallet';
import { diag } from '../diag';

const queryClient = new QueryClient();

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

export const LiFiApp: React.FC<ExchangeMountOptions> = ({
  projectId = PROJECT_ID,
  initialSettings: _initialSettings,
  onSettingsChange,
  onWalletConnect: _onWalletConnect,
  onWalletDisconnect: _onWalletDisconnect,
}) => {
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
      providers: [
        EthereumProvider(),
      ],
      walletConfig: {
        async onConnect() {
          console.log('[CoinMan Exchange] Li-Fi connected wallet');
        },
      },
    };
  }, [projectId]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <div className="coinman-exchange-wrapper">
          <div className="coinman-exchange-card">
            <WidgetEventsHandler onSettingsChange={onSettingsChange} />
            <LiFiWidget integrator="CoinMan" config={widgetConfig} />
          </div>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

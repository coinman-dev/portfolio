import React, { useMemo, useEffect } from 'react';
import { LiFiWidget, WidgetConfig, useWidgetEvents, WidgetEvent } from '@lifi/widget';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EthereumProvider } from '@lifi/widget-provider-ethereum';
import { ExchangeMountOptions } from './types';
import { wagmiConfig, defaultMetadata, PROJECT_ID } from './wallet';

const queryClient = new QueryClient();

function WidgetEventsHandler({ onSettingsChange }: { onSettingsChange?: (settings: any) => void }) {
  const widgetEvents = useWidgetEvents();

  useEffect(() => {
    const onExecutionStarted = (route: any) => {
      console.log('[CoinMan Exchange] Route execution started:', route);
    };

    const onExecutionCompleted = (route: any) => {
      console.log('[CoinMan Exchange] Route execution completed:', route);
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
    widgetEvents.on(WidgetEvent.RouteExecutionCompleted, onExecutionCompleted);
    widgetEvents.on(WidgetEvent.SettingUpdated, onSettingUpdated);

    return () => {
      widgetEvents.off(WidgetEvent.RouteExecutionStarted, onExecutionStarted);
      widgetEvents.off(WidgetEvent.RouteExecutionCompleted, onExecutionCompleted);
      widgetEvents.off(WidgetEvent.SettingUpdated, onSettingUpdated);
    };
  }, [widgetEvents, onSettingsChange]);

  return null;
}

export const LiFiApp: React.FC<ExchangeMountOptions> = ({
  projectId = PROJECT_ID,
  initialSettings,
  onSettingsChange,
}) => {
  const widgetConfig = useMemo<WidgetConfig>(() => {
    return {
      integrator: 'CoinMan-Portfolio',
      variant: 'compact',
      appearance: 'dark',
      theme: {
        palette: {
          primary: { main: '#f59e0b' },
          background: {
            default: '#18181b',
            paper: '#27272a',
          },
          text: {
            primary: '#f3f4f6',
            secondary: '#9ca3af',
          },
        },
        shape: {
          borderRadius: 12,
          borderRadiusSecondary: 8,
        },
      },
      providers: [
        EthereumProvider({
          walletConnect: {
            projectId,
            metadata: defaultMetadata,
            showQrModal: true,
            qrModalOptions: {
              themeMode: 'dark',
              themeVariables: {
                '--wcm-z-index': '10001',
              },
            },
          },
        }),
      ],
      slippage: initialSettings?.slippage !== undefined ? Number(initialSettings.slippage) : undefined,
      fromChain: initialSettings?.fromChain || undefined,
      toChain: initialSettings?.toChain || undefined,
    };
  }, [projectId, initialSettings]);

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={true}>
      <QueryClientProvider client={queryClient}>
        <div className="coinman-exchange-wrapper">
          <div className="coinman-exchange-card">
            <WidgetEventsHandler onSettingsChange={onSettingsChange} />
            <LiFiWidget integrator="CoinMan-Portfolio" config={widgetConfig} />
          </div>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

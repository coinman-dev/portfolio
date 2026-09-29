import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { ExchangeMountOptions } from '../../types';
import { getWalletStatus, subscribeWalletStatus, wagmiConfig } from '../../wallet/wallet';
import { openExternal } from '../../earn/openExternal';
import { diag } from '../../diag';
import { BrChain, BrToken, ChainType, ProviderId, QuoteRequest, RouteQuote } from './types';
import { fetchChains, fetchToken, fetchTokens, isNative } from './catalog';
import {
  CLOSE_PCT,
  FEE_CAP_PCT,
  Failure,
  PROVIDER_FEES,
  PROVIDERS,
  otherSites,
  rankRoutes,
  searchRoutes,
} from './search';
import { FAMILY_NAMES, formatAmount, formatUSD, isAddressFor, shortAddress } from './format';
import { Logo, TokenSelect } from './TokenSelect';
import { RouteCard } from './RouteCard';
import { ExecutePanel } from './ExecutePanel';
import { executionBlocker } from './execute/plan';
import { readBalance } from './execute/balance';
import { RankedRoute } from './search';
import './bestrate.css';

/** Chains the wallet connection can send on. */
const WALLET_CHAINS = wagmiConfig.chains.map((c) => c.id as number);
/** Services whose routes get a Swap button (others only link to their site). */
const SIGNABLE: ProviderId[] = ['relay', 'socket', 'kyberswap', 'debridge', 'lifi'];

interface Pick {
  chainId: number;
  token: string;
}

interface BestRateSettings {
  from?: Pick;
  to?: Pick;
  amount?: string;
  slippageBps?: number;
  feeCapPct?: number;
  disabled?: ProviderId[];
  /** Typed-in addresses for the non-EVM families (EVM comes from the wallet). */
  addresses?: Partial<Record<ChainType, string>>;
  nearApiKey?: string;
}

const DEFAULT_FROM: Pick = { chainId: 1, token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
const DEFAULT_TO: Pick = { chainId: 42161, token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' };
const SLIPPAGES = [10, 50, 100];
const FEE_CAPS = [0, 0.05, 0.1, FEE_CAP_PCT];
const SEARCH_DELAY_MS = 700;

async function resolveToken(pick: Pick): Promise<BrToken | null> {
  const list = await fetchTokens(pick.chainId).catch(() => [] as BrToken[]);
  return list.find((t) => t.address.toLowerCase() === pick.token.toLowerCase()) ?? fetchToken(pick.chainId, pick.token);
}

function parseAmount(text: string, decimals: number): bigint | null {
  const clean = text.trim();
  if (!clean || !/^\d*\.?\d*$/.test(clean) || clean === '.') return null;
  try {
    const value = parseUnits(clean, decimals);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export const BestRateApp: React.FC<ExchangeMountOptions> = ({ initialSettings, onSettingsChange }) => {
  const saved = (initialSettings?.bestRate ?? {}) as BestRateSettings;
  const [settings, setSettings] = useState<BestRateSettings>(saved);
  const [chains, setChains] = useState<BrChain[]>([]);
  const [fromToken, setFromToken] = useState<BrToken | null>(null);
  const [toToken, setToToken] = useState<BrToken | null>(null);
  const [amountText, setAmountText] = useState(saved.amount ?? '1000');
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [evmAddress, setEvmAddress] = useState<string | undefined>(getWalletStatus().address);
  const [nativePrice, setNativePrice] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [routes, setRoutes] = useState<RouteQuote[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [pending, setPending] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [executing, setExecuting] = useState<RankedRoute | null>(null);
  /** The wallet's balance of the input token; null when it cannot be read here. */
  const [balance, setBalance] = useState<bigint | null>(null);
  // Sending to someone else is set per session and never saved: after a
  // restart swaps go back to the user's own address.
  const [customReceiver, setCustomReceiver] = useState(false);
  const [receiverText, setReceiverText] = useState('');

  const update = useCallback(
    (patch: Partial<BestRateSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        onSettingsChange?.({ bestRate: next });
        return next;
      });
    },
    [onSettingsChange]
  );

  useEffect(() => subscribeWalletStatus((status) => setEvmAddress(status.address)), []);

  useEffect(() => {
    fetchChains()
      .then(setChains)
      .catch((err) => setLoadError(`Could not load networks: ${err?.message ?? err}`));
    void resolveToken(saved.from ?? DEFAULT_FROM).then(setFromToken);
    void resolveToken(saved.to ?? DEFAULT_TO).then(setToToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromChain = chains.find((c) => c.id === fromToken?.chainId);
  const toChain = chains.find((c) => c.id === toToken?.chainId);

  useEffect(() => {
    if (!fromChain) return;
    let cancelled = false;
    fetchTokens(fromChain.id)
      .then((list) => {
        const native = list.find((t) => isNative(fromChain, t));
        if (!cancelled) setNativePrice(native?.priceUSD ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fromChain]);

  useEffect(() => {
    setBalance(null);
    if (!fromChain || !fromToken || !evmAddress || fromChain.type !== 'EVM' || !WALLET_CHAINS.includes(fromChain.id)) {
      return;
    }
    let cancelled = false;
    const token = isNative(fromChain, fromToken) ? null : (fromToken.address as `0x${string}`);
    readBalance(fromChain.id, token, evmAddress as `0x${string}`)
      .then((value) => !cancelled && setBalance(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fromChain, fromToken, evmAddress, refreshTick]);

  const amount = fromToken ? parseAmount(amountText, fromToken.decimals) : null;
  const addresses = settings.addresses ?? {};
  const addressOf = (chain?: BrChain) =>
    !chain ? undefined : chain.type === 'EVM' ? evmAddress : addresses[chain.type]?.trim() || undefined;
  const fromAddress = addressOf(fromChain);
  // A custom receiver replaces the default one; with the box ticked but the
  // field empty or wrong there is no receiver at all, so nothing can be sent.
  const toAddress = customReceiver ? receiverText.trim() || undefined : addressOf(toChain);
  const receiverInvalid = customReceiver && !!toChain && receiverText.trim() !== '' && !isAddressFor(toChain.type, receiverText);
  const families = [
    ...new Set(
      [fromChain?.type, customReceiver ? undefined : toChain?.type].filter((t): t is ChainType => !!t && t !== 'EVM')
    ),
  ];

  const request: QuoteRequest | null = useMemo(() => {
    if (!fromChain || !toChain || !fromToken || !toToken || !amount) return null;
    if (fromChain.id === toChain.id && fromToken.address.toLowerCase() === toToken.address.toLowerCase()) return null;
    return {
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      fromAddress: fromAddress && isAddressFor(fromChain.type, fromAddress) ? fromAddress : undefined,
      toAddress: toAddress && isAddressFor(toChain.type, toAddress) ? toAddress : undefined,
      slippageBps: settings.slippageBps ?? 50,
      fromNativePriceUSD: nativePrice,
      nearApiKey: settings.nearApiKey?.trim() || undefined,
    };
  }, [fromChain, toChain, fromToken, toToken, amount, fromAddress, toAddress, settings.slippageBps, nativePrice, settings.nearApiKey]);

  const disabled = useMemo(() => new Set(settings.disabled ?? []), [settings.disabled]);
  const requestKey = request
    ? [
        request.fromChain.id,
        request.fromToken.address,
        request.toChain.id,
        request.toToken.address,
        request.amount.toString(),
        request.fromAddress,
        request.toAddress,
        request.slippageBps,
        request.nearApiKey ? 'key' : '',
        [...disabled].sort().join(','),
        refreshTick,
      ].join('|')
    : '';
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    const req = requestRef.current;
    setRoutes([]);
    setFailures([]);
    if (!req) {
      setPending(0);
      return;
    }
    const controller = new AbortController();
    const enabled = (id: ProviderId) => !disabled.has(id);
    const timer = setTimeout(() => {
      setPending(PROVIDERS.filter((p) => enabled(p.id)).length);
      void searchRoutes(req, enabled, controller.signal, (partial, left) => {
        setRoutes(partial.routes);
        setFailures(partial.failures);
        setPending(left);
        if (left === 0) {
          setUpdatedAt(new Date());
          const { ranked } = rankRoutes(partial.routes, req, settings.feeCapPct ?? FEE_CAP_PCT);
          const top = ranked.find((r) => r.badges.includes('recommended'));
          diag(
            'info',
            'BESTRATE',
            `${formatAmount(req.amount, req.fromToken.decimals)} ${req.fromToken.symbol} (${req.fromChain.name}) → ` +
              `${req.toToken.symbol} (${req.toChain.name}): ${partial.routes.length} routes, ` +
              `recommended ${top ? `${top.providerName} via ${top.via} net ${top.netUSD.toFixed(2)}$` : 'none'}; ` +
              `no route: ${partial.failures.map((f) => `${f.name} (${f.reason})`).join(', ') || '-'}`
          );
        }
      });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const feeCap = settings.feeCapPct ?? FEE_CAP_PCT;
  const ranking = useMemo(
    () => (request ? rankRoutes(routes.filter((r) => !disabled.has(r.provider)), request, feeCap) : null),
    [routes, request, feeCap, disabled]
  );
  const bestNet = ranking?.ranked.find((r) => r.badges.includes('best'))?.netUSD;
  const [showAll, setShowAll] = useState(false);
  // One row per service unless asked for more: LI.FI alone returns up to ten.
  const visible = useMemo(() => {
    if (!ranking || showAll) return ranking?.ranked ?? [];
    const seen = new Set<string>();
    return ranking.ranked.filter((route) => {
      const first = !seen.has(route.provider);
      seen.add(route.provider);
      return first || route.badges.length > 0;
    });
  }, [ranking, showAll]);

  const choose = (side: 'from' | 'to', chain: BrChain, token: BrToken) => {
    if (side === 'from') setFromToken(token);
    else setToToken(token);
    update({ [side]: { chainId: chain.id, token: token.address } });
    setPicker(null);
  };

  const flip = () => {
    if (!fromToken || !toToken) return;
    setFromToken(toToken);
    setToToken(fromToken);
    update({
      from: { chainId: toToken.chainId, token: toToken.address },
      to: { chainId: fromToken.chainId, token: fromToken.address },
    });
  };

  const inputUSD = ranking?.inputUSD ?? 0;

  return (
    <div className="br-root">
      <div className="br-layout">
        <section className="br-card br-form">
          <div className="br-form__head">
            <h2>Best rate</h2>
            <button
              type="button"
              className="br-icon-btn"
              aria-label="Settings"
              title="Settings"
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙
            </button>
          </div>
          <p className="br-muted br-form__lead">
            Compares {PROVIDERS.length} services side by side. Swap signs the route from your wallet after checking
            the contract and simulating it; the site button opens the service itself.
          </p>

          {showSettings && (
            <div className="br-settings">
              <label>
                Slippage
                <span className="br-seg">
                  {SLIPPAGES.map((bps) => (
                    <button
                      key={bps}
                      type="button"
                      className={(settings.slippageBps ?? 50) === bps ? 'is-active' : ''}
                      onClick={() => update({ slippageBps: bps })}
                    >
                      {bps / 100}%
                    </button>
                  ))}
                </span>
              </label>
              <label>
                Max service fee
                <span className="br-seg">
                  {FEE_CAPS.map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      className={feeCap === cap ? 'is-active' : ''}
                      onClick={() => update({ feeCapPct: cap })}
                    >
                      {cap}%
                    </button>
                  ))}
                </span>
              </label>
              <div className="br-settings__providers">
                {PROVIDERS.map((p) => (
                  <label key={p.id} className="br-check">
                    <input
                      type="checkbox"
                      checked={!disabled.has(p.id)}
                      onChange={(e) => {
                        const next = new Set(disabled);
                        if (e.target.checked) next.delete(p.id);
                        else next.add(p.id);
                        update({ disabled: [...next] });
                      }}
                    />
                    <span>
                      <strong>{p.name}</strong> <span className="br-muted">{PROVIDER_FEES[p.id]}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="br-settings__key">
                NEAR Intents API key
                <input
                  className="br-input"
                  type="password"
                  placeholder="From partners.near-intents.org — lowers its fee"
                  value={settings.nearApiKey ?? ''}
                  onChange={(e) => update({ nearApiKey: e.target.value })}
                />
              </label>
            </div>
          )}

          <div className="br-side">
            <span className="br-side__label">You send</span>
            <button type="button" className="br-pick" onClick={() => setPicker('from')} disabled={!chains.length}>
              {fromToken && fromChain ? (
                <>
                  <Logo src={fromToken.logo} alt={fromToken.symbol} />
                  <span>
                    <strong>{fromToken.symbol}</strong>
                    <span className="br-muted"> on {fromChain.name}</span>
                  </span>
                </>
              ) : (
                <span className="br-muted">Loading…</span>
              )}
            </button>
            <input
              className="br-input br-amount"
              inputMode="decimal"
              value={amountText}
              placeholder="0.0"
              onChange={(e) => {
                const text = e.target.value.replace(',', '.');
                if (/^\d*\.?\d*$/.test(text)) {
                  setAmountText(text);
                  update({ amount: text });
                }
              }}
            />
            <span className="br-side__row">
              <span className="br-muted">{inputUSD ? formatUSD(inputUSD) : ''}</span>
              {balance != null && fromToken && (
                <span className={amount && balance < amount ? 'br-warn' : 'br-muted'}>
                  Balance {formatAmount(balance, fromToken.decimals)} {fromToken.symbol}
                  {fromChain && !isNative(fromChain, fromToken) && balance > 0n && (
                    <button
                      type="button"
                      className="br-link br-max"
                      onClick={() => {
                        const text = formatUnits(balance, fromToken.decimals);
                        setAmountText(text);
                        update({ amount: text });
                      }}
                    >
                      Max
                    </button>
                  )}
                </span>
              )}
            </span>
            {fromToken && fromToken.status !== 'verified' && (
              <span className="br-warn">This token is {fromToken.status} — check the address.</span>
            )}
          </div>

          <button type="button" className="br-flip" aria-label="Swap direction" onClick={flip}>
            ⇅
          </button>

          <div className="br-side">
            <span className="br-side__label">You receive</span>
            <button type="button" className="br-pick" onClick={() => setPicker('to')} disabled={!chains.length}>
              {toToken && toChain ? (
                <>
                  <Logo src={toToken.logo} alt={toToken.symbol} />
                  <span>
                    <strong>{toToken.symbol}</strong>
                    <span className="br-muted"> on {toChain.name}</span>
                  </span>
                </>
              ) : (
                <span className="br-muted">Loading…</span>
              )}
            </button>
            {toToken && toToken.status !== 'verified' && (
              <span className="br-warn">This token is {toToken.status} — check the address.</span>
            )}
            <label className="br-check br-receiver-toggle">
              <input
                type="checkbox"
                checked={customReceiver}
                onChange={(e) => {
                  setCustomReceiver(e.target.checked);
                  if (!e.target.checked) setReceiverText('');
                }}
              />
              <span>Send to another address</span>
            </label>
            {customReceiver && toChain && (
              <label className="br-address">
                <span className="br-side__label">Receiver on {toChain.name}</span>
                <input
                  className={`br-input br-mono${receiverInvalid ? ' is-invalid' : ''}`}
                  placeholder={`${FAMILY_NAMES[toChain.type]} address of the receiver`}
                  spellCheck={false}
                  autoComplete="off"
                  value={receiverText}
                  onChange={(e) => setReceiverText(e.target.value)}
                />
                {receiverInvalid && (
                  <span className="br-warn">
                    Not a valid {FAMILY_NAMES[toChain.type]} address
                    {toChain.type === 'EVM' ? ' (or a checksum typo)' : ''}.
                  </span>
                )}
                <span className="br-muted">Funds sent to a wrong address cannot be recovered.</span>
              </label>
            )}
          </div>

          <div className="br-addresses">
            <div className="br-address">
              <span className="br-side__label">EVM address</span>
              <span className={evmAddress ? '' : 'br-muted'}>
                {evmAddress ? shortAddress(evmAddress) : 'No wallet connected — quotes use a stand-in address'}
              </span>
            </div>
            {families.map((family) => {
              const value = addresses[family] ?? '';
              const invalid = value.trim() !== '' && !isAddressFor(family, value);
              return (
                <label key={family} className="br-address">
                  <span className="br-side__label">{FAMILY_NAMES[family]} address</span>
                  <input
                    className={`br-input${invalid ? ' is-invalid' : ''}`}
                    placeholder={`Your ${FAMILY_NAMES[family]} address — needed for quotes`}
                    value={value}
                    onChange={(e) => update({ addresses: { ...addresses, [family]: e.target.value } })}
                  />
                  {invalid && <span className="br-warn">Not a valid {FAMILY_NAMES[family]} address.</span>}
                </label>
              );
            })}
          </div>

          <div className="br-sites">
            <span className="br-side__label">Also check on their own sites</span>
            {request &&
              otherSites(request).map((site) => (
                <button key={site.name} type="button" className="br-link" onClick={() => openExternal(site.url)}>
                  {site.name} ↗ <span className="br-muted">{site.note}</span>
                </button>
              ))}
          </div>
        </section>

        <section className="br-card br-results">
          <div className="br-results__head">
            <h3>Routes</h3>
            <span className="br-muted">
              {pending > 0
                ? `Asking ${pending} more service${pending > 1 ? 's' : ''}…`
                : updatedAt
                  ? `Updated ${updatedAt.toLocaleTimeString()}`
                  : ''}
            </span>
            <button
              type="button"
              className="br-btn br-btn--ghost"
              disabled={!request || pending > 0}
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              Refresh
            </button>
          </div>

          {loadError && <div className="br-warn">{loadError}</div>}
          {!request && !loadError && <div className="br-muted br-pad">Enter an amount to compare routes.</div>}
          {request && !ranking?.ranked.length && pending > 0 && <div className="br-muted br-pad">Searching…</div>}
          {request && !ranking?.ranked.length && pending === 0 && updatedAt && (
            <div className="br-muted br-pad">No route under your fee limit.</div>
          )}

          {ranking && toToken && (
            <div className="br-routes">
              {visible.map((route) => (
                <RouteCard
                  key={route.id}
                  route={route}
                  toToken={toToken}
                  bestNetUSD={bestNet}
                  onOpenSite={openExternal}
                  swapBlocker={
                    SIGNABLE.includes(route.provider) && !route.estimateOnly && request
                      ? executionBlocker(route, request, WALLET_CHAINS, balance)
                      : undefined
                  }
                  onSwap={() => setExecuting(route)}
                />
              ))}
              {ranking.ranked.length > visible.length && (
                <button type="button" className="br-link" onClick={() => setShowAll(true)}>
                  Show all {ranking.ranked.length} routes
                </button>
              )}
              {showAll && (
                <button type="button" className="br-link" onClick={() => setShowAll(false)}>
                  Best route per service only
                </button>
              )}
            </div>
          )}

          {ranking && ranking.overCap.length > 0 && (
            <details className="br-more">
              <summary>Over your {feeCap}% fee limit ({ranking.overCap.length})</summary>
              {ranking.overCap.map((route) => (
                <div key={route.id} className="br-muted">
                  {route.providerName} via {route.via}: {formatAmount(route.toAmount, toToken!.decimals)}{' '}
                  {toToken!.symbol}, fee {route.serviceFeePct?.toFixed(2)}%
                </div>
              ))}
            </details>
          )}

          {failures.length > 0 && (
            <details className="br-more">
              <summary>No route from {failures.length} service{failures.length > 1 ? 's' : ''}</summary>
              {failures.map((f) => (
                <div key={f.provider} className="br-muted">
                  {f.name}: {f.reason}
                </div>
              ))}
            </details>
          )}

          <p className="br-muted br-footnote">
            Net = amount received minus gas and fees paid on top. When routes are within {CLOSE_PCT}% of each other,
            the more reliable service is recommended. Quotes move every few seconds.
          </p>
        </section>
      </div>

      {executing && request && (
        <ExecutePanel
          route={executing}
          req={request}
          onClose={(finished) => {
            setExecuting(null);
            if (finished) setRefreshTick((n) => n + 1);
          }}
        />
      )}

      {picker && chains.length > 0 && (
        <TokenSelect
          title={picker === 'from' ? 'You send' : 'You receive'}
          chains={chains}
          chainId={(picker === 'from' ? fromToken?.chainId : toToken?.chainId) ?? 1}
          onSelect={(chain, token) => choose(picker, chain, token)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
};

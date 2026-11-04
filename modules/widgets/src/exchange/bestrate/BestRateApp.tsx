import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { ExchangeMountOptions } from '../../types';
import { getWalletStatus, subscribeWalletStatus, wagmiConfig } from '../../wallet/wallet';
import { openExternal } from '../../earn/openExternal';
import { diag } from '../../diag';
import { BrChain, BrToken, ProviderId, QuoteRequest, RouteQuote } from './types';
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
import { addressKey, addressName, formatAmount, formatUSD, isAddressFor, shortAddress } from './format';
import { Logo, TokenSelect } from './TokenSelect';
import { RouteCard, RouteSection } from './RouteCard';
import { ExecutePanel } from './ExecutePanel';
import { DepositPanel } from './DepositPanel';
import { isMayaDepositChain } from './providers/maya';
import { HistoryPanel } from './HistoryPanel';
import { resumePending } from './history';
import { executionBlocker } from './execute/plan';
import { readBalance } from './execute/balance';
import { RankedRoute } from './search';
import { Lang, intlLocale, plural, setLang, tr, useLang, useSavedLang, useT } from './i18n';
import './bestrate.css';

/** swap.cow.fi/#/<chain>/swap/<sell>/<buy>?sellAmount=… → the pair for the CoW Swap tab. */
function cowTrade(url: string) {
  const match = /^https:\/\/swap\.cow\.fi\/#\/(\d+)\/swap\/([^/?]+)\/([^/?]+)(?:\?(.*))?$/.exec(url);
  if (!match) return null;
  const sellAmount = new URLSearchParams(match[4] ?? '').get('sellAmount') ?? undefined;
  return { chainId: Number(match[1]), sell: match[2], buy: match[3], sellAmount };
}

/**
 * Services the app has a tab for open there with the pair filled in: jumper.xyz
 * in the Jumper Exchange tab (with the CoinMan wallet), CoW Swap in its own
 * tab; other sites in the browser.
 */
function openSite(url: string): void {
  const exchange = (window as any).AppExchange;
  if (url.startsWith('https://jumper.xyz/') && typeof exchange?.openJumper === 'function') {
    exchange.openJumper(url);
    return;
  }
  const trade = cowTrade(url);
  if (trade && typeof exchange?.openCowSwap === 'function') {
    exchange.openCowSwap(trade);
    return;
  }
  openExternal(url);
}

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
  /**
   * Typed-in addresses, keyed by `addressKey`: one per non-EVM family, one per
   * UTXO chain (EVM comes from the wallet). `UTXO` is an older Bitcoin entry.
   */
  addresses?: Partial<Record<string, string>>;
  nearApiKey?: string;
  lang?: Lang;
}

const DEFAULT_FROM: Pick = { chainId: 1, token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
const DEFAULT_TO: Pick = { chainId: 42161, token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' };
const SLIPPAGES = [10, 25, 50, 100];
const FEE_CAPS = [0, 0.05, 0.1, FEE_CAP_PCT];
const SEARCH_DELAY_MS = 700;

const LANGS: Lang[] = ['ru', 'en'];

const LangSwitch: React.FC = () => {
  const t = useT();
  const lang = useLang();
  return (
    <div className="br-lang" role="group" aria-label={t('Switch language')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={lang === code ? 'is-active' : ''}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

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
  // `update` is defined further down; the save only runs from an effect, after it exists.
  useSavedLang(saved.lang, (next) => update({ lang: next }));
  const t = useT();
  const lang = useLang();
  const services = (n: number) =>
    lang === 'ru' ? plural(n, 'сервис', 'сервиса', 'сервисов') : n === 1 ? 'service' : 'services';
  const [chains, setChains] = useState<BrChain[]>([]);
  const [fromToken, setFromToken] = useState<BrToken | null>(null);
  const [toToken, setToToken] = useState<BrToken | null>(null);
  const [amountText, setAmountText] = useState(saved.amount ?? '1000');
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [evmAddress, setEvmAddress] = useState<string | undefined>(getWalletStatus().address);
  /** The selected wallet is not connected: quotes and balance for it, no signing. */
  const [viewOnly, setViewOnly] = useState(getWalletStatus().readOnly);
  const [nativePrice, setNativePrice] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [routes, setRoutes] = useState<RouteQuote[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [pending, setPending] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [executing, setExecuting] = useState<RankedRoute | null>(null);
  const [depositing, setDepositing] = useState<RankedRoute | null>(null);
  /** The wallet's balance of the input token; null when it cannot be read here. */
  const [balance, setBalance] = useState<bigint | null>(null);
  // Sending to someone else is set per session and never saved: after a
  // restart swaps go back to the user's own address.
  const [receiverBox, setReceiverBox] = useState(false);
  const [receiverText, setReceiverText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const closeHistory = useCallback(() => setShowHistory(false), []);

  // Transfers that were still on their way at the last close are followed
  // again in the background, so their outcome lands in the history.
  useEffect(() => {
    const controller = new AbortController();
    void resumePending(controller.signal);
    return () => controller.abort();
  }, []);

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

  useEffect(
    () =>
      subscribeWalletStatus((status) => {
        setEvmAddress(status.address);
        setViewOnly(status.readOnly);
      }),
    []
  );

  useEffect(() => {
    fetchChains()
      .then(setChains)
      .catch((err) => setLoadError(tr('Could not load networks: {error}', { error: err?.message ?? err })));
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
  const typedAddress = (chain: BrChain) => {
    const key = addressKey(chain);
    return addresses[key] ?? (key === 'btc' ? addresses.UTXO : undefined) ?? '';
  };
  const addressOf = (chain?: BrChain) =>
    !chain ? undefined : chain.type === 'EVM' ? evmAddress : typedAddress(chain).trim() || undefined;
  const fromAddress = addressOf(fromChain);
  // Only an EVM receiver defaults to the wallet and so needs the "another
  // address" box; elsewhere the typed-in address field already is the receiver.
  const receiverChoice = toChain?.type === 'EVM';
  const customReceiver = receiverBox && receiverChoice;
  // A custom receiver replaces the default one; with the box ticked but the
  // field empty or wrong there is no receiver at all, so nothing can be sent.
  const toAddress = customReceiver ? receiverText.trim() || undefined : addressOf(toChain);
  const receiverInvalid = customReceiver && !!toChain && receiverText.trim() !== '' && !isAddressFor(toChain, receiverText);
  // One address field per non-EVM chain in use (Bitcoin and Dash need their own).
  const addressChains = [fromChain, customReceiver ? undefined : toChain]
    .filter((c): c is BrChain => !!c && c.type !== 'EVM')
    .filter((c, i, list) => list.findIndex((o) => addressKey(o) === addressKey(c)) === i);
  // Quotes run on a stand-in for these; deposits and swaps wait for the real one.
  const missing = addressChains.filter((c) => !isAddressFor(c, typedAddress(c)));
  const missingNames = missing.map(addressName).join(t(' and '));
  // Only a missing receiver holds up a deposit or swap; a sender stand-in only shapes quotes.
  const receiverMissing = !!toChain && missing.some((c) => addressKey(c) === addressKey(toChain));

  const request: QuoteRequest | null = useMemo(() => {
    if (!fromChain || !toChain || !fromToken || !toToken || !amount) return null;
    if (fromChain.id === toChain.id && fromToken.address.toLowerCase() === toToken.address.toLowerCase()) return null;
    return {
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      fromAddress: fromAddress && isAddressFor(fromChain, fromAddress) ? fromAddress : undefined,
      toAddress: toAddress && isAddressFor(toChain, toAddress) ? toAddress : undefined,
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
        // Notes and reasons come back in the language asked for.
        lang,
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
  // Routes signable in the app first, site-only ones below; each list shows
  // its best two (from different services) until expanded.
  const [expanded, setExpanded] = useState({ here: false, deposit: false, site: false });
  const sections = useMemo(() => {
    if (!ranking || !request) return null;
    const signableHere = (route: RankedRoute) =>
      SIGNABLE.includes(route.provider) &&
      !route.estimateOnly &&
      request.fromChain.type === 'EVM' &&
      WALLET_CHAINS.includes(request.fromChain.id);
    // Maya from Bitcoin, Dash or Zcash: the user sends to the vault by hand.
    const depositHere = (route: RankedRoute) => route.provider === 'maya' && isMayaDepositChain(request.fromChain);
    return {
      here: ranking.ranked.filter(signableHere),
      deposit: ranking.ranked.filter(depositHere),
      site: ranking.ranked.filter((route) => !signableHere(route) && !depositHere(route)),
    };
  }, [ranking, request]);

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
            <h2>{t('Best rate')}</h2>
            <LangSwitch />
            {/* Same wallet list as the Exchange menu's "Wallet Connect". */}
            <button
              type="button"
              className={`br-wallet${evmAddress ? (viewOnly ? ' is-view' : '') : ' is-empty'}`}
              title={
                evmAddress
                  ? `${evmAddress}${viewOnly ? t(' — view only, reconnect to sign') : ''}`
                  : t('No wallet connected — quotes use a stand-in address')
              }
              onClick={() => void (window as any).AppExchange?.handleWalletClick?.()}
            >
              {evmAddress ? shortAddress(evmAddress) : t('Connect wallet')}
              {evmAddress && viewOnly && <span className="br-wallet__view">{t('view only')}</span>}
            </button>
            <button
              type="button"
              className="br-icon-btn"
              aria-label={t('Settings')}
              title={t('Settings')}
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙
            </button>
          </div>
          <p className="br-muted br-form__lead">
            {t(
              'Compares {count} services side by side. Swap signs the route from your wallet after checking the contract and simulating it; the site button opens the service itself.',
              { count: PROVIDERS.length }
            )}
          </p>

          {showSettings && (
            <div className="br-settings">
              <label>
                {t('Slippage')}
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
                {t('Max service fee')}
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
                      <strong>{p.name}</strong> <span className="br-muted">{t(PROVIDER_FEES[p.id])}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="br-settings__key">
                {t('NEAR Intents API key')}
                <input
                  className="br-input"
                  type="password"
                  placeholder={t('From partners.near-intents.org — lowers its fee')}
                  value={settings.nearApiKey ?? ''}
                  onChange={(e) => update({ nearApiKey: e.target.value })}
                />
              </label>
            </div>
          )}

          <div className="br-side">
            <span className="br-side__label">{t('You send')}</span>
            <button type="button" className="br-pick" onClick={() => setPicker('from')} disabled={!chains.length}>
              {fromToken && fromChain ? (
                <>
                  <Logo src={fromToken.logo} alt={fromToken.symbol} />
                  <span>
                    <strong>{fromToken.symbol}</strong>
                    <span className="br-muted"> {t('on {chain}', { chain: fromChain.name })}</span>
                  </span>
                </>
              ) : (
                <span className="br-muted">{t('Loading…')}</span>
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
                  {t('Balance')} {formatAmount(balance, fromToken.decimals)} {fromToken.symbol}
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
                      {t('Max')}
                    </button>
                  )}
                </span>
              )}
            </span>
            {fromToken && fromToken.status !== 'verified' && (
              <span className="br-warn">
                {t('This token is {status} — check the address.', { status: t(fromToken.status) })}
              </span>
            )}
          </div>

          <button type="button" className="br-flip" aria-label={t('Swap direction')} onClick={flip}>
            ⇅
          </button>

          <div className="br-side">
            <span className="br-side__label">{t('You receive')}</span>
            <button type="button" className="br-pick" onClick={() => setPicker('to')} disabled={!chains.length}>
              {toToken && toChain ? (
                <>
                  <Logo src={toToken.logo} alt={toToken.symbol} />
                  <span>
                    <strong>{toToken.symbol}</strong>
                    <span className="br-muted"> {t('on {chain}', { chain: toChain.name })}</span>
                  </span>
                </>
              ) : (
                <span className="br-muted">{t('Loading…')}</span>
              )}
            </button>
            {toToken && toToken.status !== 'verified' && (
              <span className="br-warn">
                {t('This token is {status} — check the address.', { status: t(toToken.status) })}
              </span>
            )}
            {receiverChoice && (
              <label className="br-check br-receiver-toggle">
                <input
                  type="checkbox"
                  checked={customReceiver}
                  onChange={(e) => {
                    setReceiverBox(e.target.checked);
                    if (!e.target.checked) setReceiverText('');
                  }}
                />
                <span>{t('Send to another address')}</span>
              </label>
            )}
            {customReceiver && toChain && (
              <label className="br-address">
                <span className="br-side__label">{t('Receiver on {chain}', { chain: toChain.name })}</span>
                <input
                  className={`br-input br-mono${receiverInvalid ? ' is-invalid' : ''}`}
                  placeholder={t('{name} address of the receiver', { name: addressName(toChain) })}
                  spellCheck={false}
                  autoComplete="off"
                  value={receiverText}
                  onChange={(e) => setReceiverText(e.target.value)}
                />
                {receiverInvalid && (
                  <span className="br-warn">
                    {t(
                      toChain.type === 'EVM'
                        ? 'Not a valid {name} address (or a checksum typo).'
                        : 'Not a valid {name} address.',
                      { name: addressName(toChain) }
                    )}
                  </span>
                )}
                <span className="br-muted">{t('Funds sent to a wrong address cannot be recovered.')}</span>
              </label>
            )}
          </div>

          {addressChains.length > 0 && (
          <div className="br-addresses">
            {addressChains.map((chain) => {
              const key = addressKey(chain);
              const value = typedAddress(chain);
              const invalid = value.trim() !== '' && !isAddressFor(chain, value);
              const name = addressName(chain);
              return (
                <label key={key} className="br-address">
                  <span className="br-side__label">{t('{name} address', { name })}</span>
                  <input
                    className={`br-input${invalid ? ' is-invalid' : ''}`}
                    placeholder={t('Your {name} address — for quotes, payouts and refunds', { name })}
                    value={value}
                    onChange={(e) => update({ addresses: { ...addresses, [key]: e.target.value } })}
                  />
                  {invalid && <span className="br-warn">{t('Not a valid {name} address.', { name })}</span>}
                </label>
              );
            })}
          </div>
          )}

          <div className="br-sites">
            <span className="br-side__label">{t('Also check on their own sites')}</span>
            {request &&
              otherSites(request).map((site) => (
                <button key={site.name} type="button" className="br-link" onClick={() => openSite(site.url)}>
                  {site.name} ↗ <span className="br-muted">{t(site.note)}</span>
                </button>
              ))}
          </div>
        </section>

        <section className="br-card br-results">
          <div className="br-results__head">
            <h3>{t('Routes')}</h3>
            <span className="br-muted">
              {pending > 0
                ? t('Asking {count} more {services}…', { count: pending, services: services(pending) })
                : updatedAt
                  ? t('Updated {time}', { time: updatedAt.toLocaleTimeString(intlLocale()) })
                  : ''}
            </span>
            <button type="button" className="br-btn br-btn--ghost" onClick={() => setShowHistory(true)}>
              {t('History')}
            </button>
            <button
              type="button"
              className="br-btn br-btn--ghost"
              disabled={!request || pending > 0}
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              {t('Refresh')}
            </button>
          </div>

          {loadError && <div className="br-warn">{loadError}</div>}
          {!request && !loadError && <div className="br-muted br-pad">{t('Enter an amount to compare routes.')}</div>}
          {request && !ranking?.ranked.length && pending > 0 && <div className="br-muted br-pad">{t('Searching…')}</div>}
          {request && !ranking?.ranked.length && pending === 0 && updatedAt && (
            <div className="br-muted br-pad">
              {missingNames
                ? t('No route yet — enter your {name} address; some services need it to quote.', { name: missingNames })
                : t('No route under your fee limit.')}
            </div>
          )}
          {request && missingNames && !!ranking?.ranked.length && (
            <div className="br-muted br-pad">
              {t(
                receiverMissing
                  ? 'Quoted for a placeholder {name} address — enter yours to deposit or swap.'
                  : 'Quoted for a placeholder {name} address.',
                { name: missingNames }
              )}
            </div>
          )}

          {sections && toToken && request && ranking!.ranked.length > 0 && (
            <>
              <RouteSection
                title={t('Swap here')}
                hint={t('signed from your wallet after the contract check and simulation')}
                empty={t('None of these services can be signed here for this pair.')}
                routes={sections.here}
                expanded={expanded.here}
                onToggle={() => setExpanded((prev) => ({ ...prev, here: !prev.here }))}
                renderCard={(route) => (
                  <RouteCard
                    key={route.id}
                    route={route}
                    toToken={toToken}
                    bestNetUSD={bestNet}
                    onOpenSite={openSite}
                    swapBlocker={
                      viewOnly
                        ? t('This wallet is view only — reconnect it (Exchange → Wallet Connect) to swap')
                        : executionBlocker(route, request, WALLET_CHAINS, balance)
                    }
                    onSwap={() => setExecuting(route)}
                  />
                )}
              />
              {sections.deposit.length > 0 && (
                <RouteSection
                  title={t('Send from your own wallet')}
                  hint={t("no wallet connection: send to Maya's vault with the memo shown")}
                  empty=""
                  routes={sections.deposit}
                  expanded={expanded.deposit}
                  onToggle={() => setExpanded((prev) => ({ ...prev, deposit: !prev.deposit }))}
                  renderCard={(route) => (
                    <RouteCard
                      key={route.id}
                      route={route}
                      toToken={toToken}
                      bestNetUSD={bestNet}
                      onOpenSite={openSite}
                      depositBlocker={
                        request.toAddress ? null : t('enter the {chain} receiver address', { chain: request.toChain.name })
                      }
                      onDeposit={() => setDepositing(route)}
                    />
                  )}
                />
              )}
              <RouteSection
                title={t("On the service's site")}
                hint={t('opens the service with the pair filled in — in its tab here or on its own site')}
                empty={t("Nothing extra on the services' own sites.")}
                routes={sections.site}
                expanded={expanded.site}
                onToggle={() => setExpanded((prev) => ({ ...prev, site: !prev.site }))}
                renderCard={(route) => (
                  <RouteCard
                    key={route.id}
                    route={route}
                    toToken={toToken}
                    bestNetUSD={bestNet}
                    onOpenSite={openSite}
                  />
                )}
              />
            </>
          )}

          {ranking && ranking.overCap.length > 0 && (
            <details className="br-more">
              <summary>{t('Over your {cap}% fee limit ({count})', { cap: feeCap, count: ranking.overCap.length })}</summary>
              {ranking.overCap.map((route) => (
                <div key={route.id} className="br-muted">
                  {t('{provider} via {via}: {amount} {symbol}, fee {fee}%', {
                    provider: route.providerName,
                    via: route.via,
                    amount: formatAmount(route.toAmount, toToken!.decimals),
                    symbol: toToken!.symbol,
                    fee: route.serviceFeePct?.toFixed(2) ?? '?',
                  })}
                </div>
              ))}
            </details>
          )}

          {failures.length > 0 && (
            <details className="br-more">
              <summary>
                {t('No route from {count} {services}', { count: failures.length, services: services(failures.length) })}
              </summary>
              {failures.map((f) => (
                <div key={f.provider} className="br-muted">
                  {f.name}: {t(f.reason)}
                </div>
              ))}
            </details>
          )}

          <p className="br-muted br-footnote">
            {t(
              'Net = amount received minus gas and fees paid on top. When routes are within {pct}% of each other, the more reliable service is recommended. Quotes move every few seconds.',
              { pct: CLOSE_PCT }
            )}
          </p>
        </section>
      </div>

      {showHistory && <HistoryPanel onClose={closeHistory} />}

      {depositing && request && <DepositPanel route={depositing} req={request} onClose={() => setDepositing(null)} />}

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
          title={picker === 'from' ? t('You send') : t('You receive')}
          chains={chains}
          chainId={(picker === 'from' ? fromToken?.chainId : toToken?.chainId) ?? 1}
          onSelect={(chain, token) => choose(picker, chain, token)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
};

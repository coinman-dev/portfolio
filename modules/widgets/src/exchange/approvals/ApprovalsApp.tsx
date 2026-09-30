import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Address } from 'viem';
import { ExchangeMountOptions } from '../../types';
import { subscribeWalletStatus } from '../../wallet/wallet';
import { connectTron, disconnectTron, subscribeTron } from '../../wallet/tron';
import { connectSolana, disconnectSolana, subscribeSolana } from '../../wallet/solana';
import { openExternal } from '../../earn/openExternal';
import { diag } from '../../diag';
import { formatAmount, formatUSD, shortAddress } from '../bestrate/format';
import { Logo } from '../bestrate/TokenSelect';
import '../bestrate/bestrate.css';
import './approvals.css';
import { EVM_SCAN_CHAINS, SOLANA_CHAIN_ID, TRON_CHAIN_ID, addressUrl } from './chains';
import { NeedsKeyError } from './evm/events';
import { scanEvmChain } from './evm/scan';
import { scanTron } from './tron';
import { scanSolana } from './solana';
import { eachLimited } from './spenders';
import { isRisky } from './risk';
import { RevokePanel, Owners } from './RevokePanel';
import { RevokeHistory } from './RevokeHistory';
import { Approval, ChainScan, Family, RiskLevel } from './types';

interface ApprovalsSettings {
  hypersyncKey?: string;
  /** EVM networks left out of scans. */
  skipChains?: number[];
}

const RISK_LABELS: Record<RiskLevel, string> = { high: 'High risk', medium: 'Risky', low: 'Low' };
const KIND_LABELS: Record<Approval['kind'], string> = {
  token: 'Token',
  'nft-token': 'One NFT',
  'nft-all': 'NFT collection',
  permit2: 'Permit2',
  delegate: 'Delegate',
};
const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };
const EVM_CONCURRENCY = 4;

const isUserRejection = (err: any) =>
  err?.code === 4001 || /reject|denied|cancel|closed/i.test(String(err?.message ?? err));

function amountText(a: Approval): string {
  if (a.kind === 'nft-all') return 'All NFTs';
  if (a.kind === 'nft-token') return `#${a.tokenId}`;
  if (a.unlimited) return 'Unlimited';
  if (a.amount == null) return '—';
  return `${formatAmount(a.amount, a.decimals ?? 0)} ${a.symbol}`;
}

function scanKey(family: Family, chainId: number) {
  return family === 'EVM' ? `EVM:${chainId}` : family;
}

function WalletChip({
  label,
  address,
  hint,
  onConnect,
  onDisconnect,
}: {
  label: string;
  address?: string | null;
  hint: string;
  onConnect: () => void;
  onDisconnect?: () => void;
}) {
  return (
    <span className="ap-chip">
      <button
        type="button"
        className={`br-wallet${address ? '' : ' is-empty'}`}
        title={address ?? hint}
        onClick={onConnect}
      >
        {label} {address ? shortAddress(address) : '— connect'}
      </button>
      {address && onDisconnect && (
        <button type="button" className="ap-chip__x" title={`Disconnect the ${label} wallet`} onClick={onDisconnect}>
          ×
        </button>
      )}
    </span>
  );
}

function ApprovalRow({
  a,
  selected,
  onToggle,
  onRevoke,
}: {
  a: Approval;
  selected: boolean;
  onToggle: () => void;
  onRevoke: () => void;
}) {
  const s = a.spenderInfo;
  const spenderUrl = addressUrl(a.family, a.chainId, a.spender);
  const tokenUrl = addressUrl(a.family, a.chainId, a.token);
  const warnings = a.reasons.filter((r) => r.level !== 'low');
  const notes = a.reasons.filter((r) => r.level === 'low').map((r) => r.text).join(' · ');
  return (
    <div className={`ap-row ap-row--${a.risk}${selected ? ' is-selected' : ''}`}>
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label="Select" />
      <div className="ap-asset">
        <Logo src={a.logo} alt={a.symbol} />
        <div>
          <button type="button" className="ap-plain" title={a.token} onClick={() => tokenUrl && openExternal(tokenUrl)}>
            <strong>{a.symbol}</strong>
          </button>
          <div className="br-muted ap-small">{KIND_LABELS[a.kind]}</div>
        </div>
      </div>
      <div className="ap-spender">
        <button type="button" className="ap-plain" title={a.spender} onClick={() => spenderUrl && openExternal(spenderUrl)}>
          {s.name ?? shortAddress(a.spender)} ↗
        </button>
        <div className="ap-small">
          {s.type === 'account' && <span className="br-tag br-tag--bad">plain account</span>}
          {s.scam && <span className="br-tag br-tag--bad">scam</span>}
          {s.type === 'contract' && s.verified === false && <span className="br-tag br-tag--warn">code not published</span>}
          {s.known && <span className="br-tag ap-tag--ok">known</span>}
          {s.name && <span className="br-muted ap-mono">{shortAddress(a.spender)}</span>}
        </div>
      </div>
      <div className="ap-amount">{amountText(a)}</div>
      <div className="ap-value">{a.atRiskUSD != null ? formatUSD(a.atRiskUSD) : '—'}</div>
      <div className="ap-date br-muted">{a.lastChange ? new Date(a.lastChange * 1000).toLocaleDateString() : '—'}</div>
      <span className={`ap-badge ap-badge--${a.risk}`} title={notes}>
        {RISK_LABELS[a.risk]}
      </span>
      <button type="button" className="br-btn br-btn--ghost" onClick={onRevoke}>
        Revoke
      </button>
      {(warnings.length > 0 || notes) && (
        <div className="ap-reasons">
          {warnings.map((r, i) => (
            <span key={i} className={r.level === 'high' ? 'ap-bad' : 'br-warn'}>
              {r.text}
            </span>
          ))}
          {notes && <span className="br-muted">{notes}</span>}
        </div>
      )}
    </div>
  );
}

export const ApprovalsApp: React.FC<ExchangeMountOptions> = ({ initialSettings, onSettingsChange }) => {
  const saved = (initialSettings?.approvals ?? {}) as ApprovalsSettings;
  const [settings, setSettings] = useState<ApprovalsSettings>(saved);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [showSettings, setShowSettings] = useState(false);
  const [keyDirty, setKeyDirty] = useState(false);

  const [evm, setEvm] = useState<string | undefined>();
  const [tron, setTron] = useState<string | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const [scans, setScans] = useState<Record<string, ChainScan>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [onlyRisky, setOnlyRisky] = useState(false);
  const [revoking, setRevoking] = useState<{ approvals: Approval[]; owners: Owners } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const closeHistory = useCallback(() => setShowHistory(false), []);
  const [walletError, setWalletError] = useState<string | null>(null);

  const controllers = useRef(new Map<string, AbortController>());

  const update = useCallback(
    (patch: Partial<ApprovalsSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        onSettingsChange?.({ approvals: next });
        return next;
      });
    },
    [onSettingsChange]
  );

  const setScan = useCallback((key: string, patch: Partial<ChainScan> & Pick<ChainScan, 'family' | 'chainId' | 'name'>) => {
    setScans((prev) => {
      const base: ChainScan = prev[key] ?? { key, family: patch.family, chainId: patch.chainId, name: patch.name, status: 'waiting', approvals: [] };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }, []);

  /** Starts (or restarts) the scan of one network; the previous run of it is dropped. */
  const runScan = useCallback(
    async (
      key: string,
      meta: { family: Family; chainId: number; name: string },
      work: (signal: AbortSignal) => Promise<{ approvals: Approval[]; source?: string; note?: string }>
    ) => {
      controllers.current.get(key)?.abort();
      const controller = new AbortController();
      controllers.current.set(key, controller);
      setScan(key, { ...meta, status: 'scanning', error: undefined, note: undefined });
      try {
        const result = await work(controller.signal);
        if (controller.signal.aborted) return;
        setScan(key, { ...meta, status: 'done', approvals: result.approvals, source: result.source, note: result.note });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        const skipped = err instanceof NeedsKeyError;
        if (!skipped) diag('warn', 'APPROVALS', `${meta.name} scan failed: ${err?.message ?? err}`);
        setScan(key, {
          ...meta,
          status: skipped ? 'skipped' : 'error',
          approvals: [],
          error: String(err?.message ?? err).slice(0, 200),
        });
      }
    },
    [setScan]
  );

  const scanEvm = useCallback(
    (owner: string | undefined, only?: number[]) => {
      if (!only) {
        // A new owner: forget every EVM result of the previous one.
        for (const [key, controller] of controllers.current) if (key.startsWith('EVM:')) controller.abort();
        setScans((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith('EVM:'))));
      }
      if (!owner) return;
      const skip = new Set(settingsRef.current.skipChains ?? []);
      const chains = EVM_SCAN_CHAINS.filter((c) => !skip.has(c.id) && (!only || only.includes(c.id)));
      chains.forEach((c) => setScan(`EVM:${c.id}`, { family: 'EVM', chainId: c.id, name: c.name, status: 'waiting' }));
      const key = settingsRef.current.hypersyncKey?.trim() || undefined;
      void eachLimited(chains, EVM_CONCURRENCY, (chain) =>
        runScan(`EVM:${chain.id}`, { family: 'EVM', chainId: chain.id, name: chain.name }, (signal) =>
          scanEvmChain(chain, owner as Address, key, signal)
        )
      );
    },
    [runScan, setScan]
  );

  const scanTronFor = useCallback(
    (owner: string | null) => {
      if (!owner) {
        controllers.current.get('TVM')?.abort();
        setScans((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== 'TVM')));
        return;
      }
      void runScan('TVM', { family: 'TVM', chainId: TRON_CHAIN_ID, name: 'Tron' }, async (signal) => ({
        ...(await scanTron(owner, signal)),
        source: 'TronGrid',
      }));
    },
    [runScan]
  );

  const scanSolanaFor = useCallback(
    (owner: string | null) => {
      if (!owner) {
        controllers.current.get('SVM')?.abort();
        setScans((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== 'SVM')));
        return;
      }
      void runScan('SVM', { family: 'SVM', chainId: SOLANA_CHAIN_ID, name: 'Solana' }, async (signal) => ({
        approvals: await scanSolana(owner, signal),
        source: 'Solana RPC',
      }));
    },
    [runScan]
  );

  // Each wallet is scanned as soon as it is connected, and again when it changes.
  useEffect(
    () =>
      subscribeWalletStatus((status) => {
        setEvm((prev) => (prev?.toLowerCase() === status.address?.toLowerCase() ? prev : status.address));
      }),
    []
  );
  useEffect(() => subscribeTron(setTron), []);
  useEffect(() => subscribeSolana(setSol), []);
  useEffect(() => scanEvm(evm), [evm, scanEvm]);
  useEffect(() => scanTronFor(tron), [tron, scanTronFor]);
  useEffect(() => scanSolanaFor(sol), [sol, scanSolanaFor]);
  useEffect(() => () => controllers.current.forEach((c) => c.abort()), []);

  const rescanAll = () => {
    setKeyDirty(false);
    scanEvm(evm);
    scanTronFor(tron);
    scanSolanaFor(sol);
  };

  const connect = async (family: 'TVM' | 'SVM') => {
    setWalletError(null);
    try {
      if (family === 'TVM') await connectTron();
      else await connectSolana();
    } catch (err: any) {
      if (!isUserRejection(err)) setWalletError(`${family === 'TVM' ? 'Tron' : 'Solana'} wallet: ${err?.message ?? err}`);
    }
  };

  // ─── What to show ───
  const ordered = useMemo(() => {
    const keys = [...EVM_SCAN_CHAINS.map((c) => `EVM:${c.id}`), 'TVM', 'SVM'];
    return keys.map((k) => scans[k]).filter((s): s is ChainScan => !!s);
  }, [scans]);
  const all = useMemo(() => ordered.flatMap((s) => s.approvals), [ordered]);
  const byId = useMemo(() => new Map(all.map((a) => [a.id, a])), [all]);
  const selectedList = [...selected].map((id) => byId.get(id)).filter((a): a is Approval => !!a);
  const risky = all.filter(isRisky);
  const atRisk = all.reduce((sum, a) => sum + (a.atRiskUSD ?? 0), 0);
  const busy = ordered.filter((s) => s.status === 'scanning' || s.status === 'waiting');
  const problems = ordered.filter((s) => s.status === 'error' || s.status === 'skipped');
  const clean = ordered.filter((s) => s.status === 'done' && !s.approvals.length);
  const notes = ordered.filter((s) => s.note);
  const visibleScans = ordered.filter(
    (s) => s.approvals.length > 0 && (chainFilter === 'all' || s.key === chainFilter)
  );
  const selectedNetworks = new Set(selectedList.map((a) => scanKey(a.family, a.chainId))).size;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openRevoke = (list: Approval[]) => {
    if (!list.length) return;
    setRevoking({ approvals: list, owners: { EVM: evm, TVM: tron ?? undefined, SVM: sol ?? undefined } });
  };

  const afterRevoke = (touched: string[]) => {
    setRevoking(null);
    setSelected(new Set());
    const evmChains = touched.filter((k) => k.startsWith('EVM:')).map((k) => Number(k.slice(4)));
    if (evmChains.length) scanEvm(evm, evmChains);
    if (touched.includes('TVM')) scanTronFor(tron);
    if (touched.includes('SVM')) scanSolanaFor(sol);
  };

  const noWallet = !evm && !tron && !sol;

  return (
    <div className="br-root ap-root">
      <section className="br-card ap-card">
        <div className="ap-head">
          <h2>Approvals</h2>
          <div className="ap-wallets">
            <WalletChip
              label="EVM"
              address={evm}
              hint="Connect a wallet"
              onConnect={() => void (window as any).AppExchange?.handleWalletClick?.()}
            />
            <WalletChip
              label="Tron"
              address={tron}
              hint="Pair a Tron wallet over WalletConnect (OneKey offers only EVM networks there)"
              onConnect={() => void connect('TVM')}
              onDisconnect={() => void disconnectTron().catch(() => undefined)}
            />
            <WalletChip
              label="Solana"
              address={sol}
              hint="Pair a Solana wallet over WalletConnect (OneKey offers only EVM networks there)"
              onConnect={() => void connect('SVM')}
              onDisconnect={() => void disconnectSolana().catch(() => undefined)}
            />
          </div>
          <button type="button" className="br-btn br-btn--ghost" onClick={() => setShowHistory(true)}>
            History
          </button>
          <button type="button" className="br-btn br-btn--ghost" disabled={noWallet || busy.length > 0} onClick={rescanAll}>
            Scan again
          </button>
          <button type="button" className="br-icon-btn" aria-label="Settings" title="Settings" onClick={() => setShowSettings(!showSettings)}>
            ⚙
          </button>
        </div>
        <p className="br-muted ap-lead">
          Everything your connected wallets have allowed others to spend, read from the networks themselves. Revoking
          takes that access away; it costs only the network fee.
        </p>
        {(!tron || !sol) && (
          <p className="br-muted ap-note">
            Tron and Solana are paired on their own. OneKey offers only EVM networks over WalletConnect — for Tron or
            Solana scan the code with a wallet that supports them (Trust Wallet, TokenPocket, SafePal, Bitget…).
          </p>
        )}
        {walletError && <div className="br-warn">{walletError}</div>}

        {showSettings && (
          <div className="br-settings">
            <label className="br-settings__key">
              HyperSync API key
              <input
                className="br-input"
                type="password"
                placeholder="From envio.dev — needed for BNB Chain, Linea, Mantle, Blast; faster everywhere"
                value={settings.hypersyncKey ?? ''}
                onChange={(e) => {
                  update({ hypersyncKey: e.target.value });
                  setKeyDirty(true);
                }}
              />
              <span className="br-muted">
                Free at{' '}
                <button type="button" className="br-link" onClick={() => openExternal('https://envio.dev/app/api-tokens')}>
                  envio.dev/app/api-tokens
                </button>
                . Stored only in this computer’s settings.{keyDirty ? ' Press “Scan again” to use it.' : ''}
              </span>
            </label>
            <div>
              <div className="br-side__label">EVM networks to scan</div>
              <div className="ap-chains">
                {EVM_SCAN_CHAINS.map((c) => {
                  const skip = new Set(settings.skipChains ?? []);
                  return (
                    <label key={c.id} className="br-check">
                      <input
                        type="checkbox"
                        checked={!skip.has(c.id)}
                        onChange={(e) => {
                          if (e.target.checked) skip.delete(c.id);
                          else skip.add(c.id);
                          update({ skipChains: [...skip] });
                        }}
                      />
                      <span>
                        {c.name}
                        {!c.events.length && <span className="br-muted"> (key)</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {noWallet ? (
          <div className="br-muted br-pad">Connect a wallet above to see what it has approved.</div>
        ) : (
          <>
            <div className="ap-summary">
              <span>
                <strong>{all.length}</strong> open approval{all.length === 1 ? '' : 's'}
              </span>
              <span className={risky.length ? 'ap-bad' : 'br-muted'}>
                <strong>{risky.length}</strong> risky
              </span>
              <span>
                <strong>{formatUSD(atRisk)}</strong> <span className="br-muted">exposed today</span>
              </span>
              {busy.length > 0 && <span className="br-muted">Scanning {busy.length} network{busy.length === 1 ? '' : 's'}…</span>}
            </div>

            <div className="ap-filters">
              <select className="br-input ap-select" value={chainFilter} onChange={(e) => setChainFilter(e.target.value)}>
                <option value="all">All networks</option>
                {ordered
                  .filter((s) => s.approvals.length)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name} ({s.approvals.length})
                    </option>
                  ))}
              </select>
              <label className="br-check">
                <input type="checkbox" checked={onlyRisky} onChange={(e) => setOnlyRisky(e.target.checked)} />
                <span>Only risky</span>
              </label>
            </div>

            {problems.length > 0 && (
              <details className="br-more" open={problems.some((p) => p.status === 'skipped')}>
                <summary>
                  {problems.length} network{problems.length === 1 ? '' : 's'} not checked
                </summary>
                {problems.map((p) => (
                  <div key={p.key} className={p.status === 'skipped' ? 'br-muted' : 'br-warn'}>
                    {p.name}: {p.error}
                  </div>
                ))}
              </details>
            )}
            {notes.map((s) => (
              <div key={s.key} className="br-warn">
                {s.name}: {s.note}
              </div>
            ))}

            {visibleScans.map((scan) => {
              const rows = scan.approvals
                .filter((a) => !onlyRisky || isRisky(a))
                .sort((x, y) => RISK_ORDER[x.risk] - RISK_ORDER[y.risk] || (y.atRiskUSD ?? 0) - (x.atRiskUSD ?? 0));
              if (!rows.length) return null;
              return (
                <div key={scan.key} className="ap-group">
                  <div className="ap-group__head">
                    <h3>{scan.name}</h3>
                    <span className="br-muted">
                      {scan.approvals.length} open · {scan.approvals.filter(isRisky).length} risky
                      {scan.source ? ` · from ${scan.source}` : ''}
                    </span>
                  </div>
                  <div className="ap-row ap-row--head br-muted">
                    <span />
                    <span>Asset</span>
                    <span>Approved to</span>
                    <span>Allowance</span>
                    <span>Exposed</span>
                    <span>Set on</span>
                    <span>Risk</span>
                    <span />
                  </div>
                  {rows.map((a) => (
                    <ApprovalRow
                      key={a.id}
                      a={a}
                      selected={selected.has(a.id)}
                      onToggle={() => toggle(a.id)}
                      onRevoke={() => openRevoke([a])}
                    />
                  ))}
                </div>
              );
            })}

            {clean.length > 0 && (
              <div className="br-muted ap-clean">No open approvals on {clean.map((s) => s.name).join(', ')}.</div>
            )}
          </>
        )}
      </section>

      {all.length > 0 && (
        <div className="ap-bar">
          <button type="button" className="br-btn br-btn--ghost" disabled={!risky.length} onClick={() => setSelected(new Set(risky.map((a) => a.id)))}>
            Select risky ({risky.length})
          </button>
          <button type="button" className="br-btn br-btn--ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <span className="br-muted ap-bar__info">
            {selectedList.length
              ? `${selectedList.length} selected on ${selectedNetworks} network${selectedNetworks === 1 ? '' : 's'}`
              : 'Nothing selected'}
          </span>
          <button type="button" className="br-btn br-btn--primary" disabled={!selectedList.length} onClick={() => openRevoke(selectedList)}>
            Revoke selected
          </button>
        </div>
      )}

      {revoking && <RevokePanel approvals={revoking.approvals} owners={revoking.owners} onClose={afterRevoke} />}
      {showHistory && <RevokeHistory onClose={closeHistory} />}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { diag } from '../../diag';
import { ThorLikeDeposit } from './providers/thorlike';
import { useT } from './i18n';
import {
  DashDraft,
  DashSource,
  DashCoreStatus,
  dashCoreStatus,
  draftDeposit,
  fromDuffs,
  loadSources,
  openDashCoreSettings,
  refreshDashCore,
  signAndSend,
} from './execute/dashcore';

/** Follows Exchange → Connect wallet → Dash Core. */
function useDashCoreStatus(): DashCoreStatus {
  const [status, setStatus] = useState(dashCoreStatus);
  useEffect(() => {
    const on = (e: Event) => setStatus({ ...(e as CustomEvent).detail });
    window.addEventListener('coinman-dashcore', on);
    return () => window.removeEventListener('coinman-dashcore', on);
  }, []);
  return status;
}

interface Props {
  deposit: ThorLikeDeposit;
  /** The quote ran out or the swap is already being followed. */
  disabled: boolean;
  onSent: (txid: string) => void;
}

type Phase = 'idle' | 'loading' | 'choose' | 'drafting' | 'review' | 'sending' | 'sent';

/**
 * "Send from Dash Core" in the DASH deposit panel: pick the paying address,
 * see the exact transaction, confirm with the wallet password, send.
 */
export const DashCoreSend: React.FC<Props> = ({ deposit, disabled, onSent }) => {
  const t = useT();
  const status = useDashCoreStatus();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<DashSource[]>([]);
  const [picked, setPicked] = useState('');
  const [draft, setDraft] = useState<DashDraft | null>(null);
  const [passphrase, setPassphrase] = useState('');

  // A new quote (vault, memo) voids a prepared transaction.
  useEffect(() => {
    setDraft(null);
    setPhase((p) => (p === 'review' || p === 'drafting' ? 'choose' : p));
  }, [deposit]);

  const key = (s: DashSource) => `${s.wallet}\u0000${s.address}`;
  const source = sources.find((s) => key(s) === picked);
  const enough = (s: DashSource) => s.total > deposit.amount;

  const load = async () => {
    setError(null);
    setPhase('loading');
    try {
      const { status: fresh, report } = await refreshDashCore();
      if (!fresh.connected) {
        const node = report?.node;
        if (node && node.synced === false) {
          throw new Error(t('Dash Core is still synchronising: {pct}% — wait until Dash-Qt finishes.', { pct: (node.progress * 100).toFixed(2) }));
        }
        if (node && !(report?.wallets ?? []).length) {
          throw new Error(t('No wallet is open in Dash-Qt — open one (File → Open Wallet).'));
        }
        const bad = (report?.checks ?? []).find((c: any) => c.required && !c.ok);
        throw new Error(bad ? `${bad.label}: ${bad.hint}` : t('Dash Core is not ready'));
      }
      const list = await loadSources(report);
      setSources(list);
      const first = list.find(enough);
      setPicked(first ? key(first) : '');
      setPhase('choose');
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setPhase('idle');
    }
  };

  const prepare = async () => {
    if (!source) return;
    setError(null);
    setPhase('drafting');
    try {
      setDraft(await draftDeposit(source, deposit));
      setPhase('review');
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setPhase('choose');
    }
  };

  const send = async () => {
    if (!draft) return;
    setError(null);
    setPhase('sending');
    try {
      const txid = await signAndSend(draft, deposit, passphrase);
      setPassphrase('');
      setPhase('sent');
      diag('info', 'BESTRATE', `Dash Core sent the deposit from ${draft.source.address}: ${txid}`);
      onSent(txid);
    } catch (err: any) {
      setPassphrase('');
      setError(err?.message ?? String(err));
      setPhase('review');
    }
  };

  if (!status.dir) {
    return (
      <div className="br-deposit__core">
        {t('Have Dash Core? Connect it (Exchange → Connect wallet → Dash Core) to send this deposit from it, without copying anything.')}{' '}
        <button type="button" className="br-link" onClick={openDashCoreSettings}>
          {t('Connect Dash Core')}
        </button>
      </div>
    );
  }

  return (
    <div className="br-dashcore">
      <div className="br-dashcore__head">
        <strong>{t('Send from Dash Core')}</strong>
        <button type="button" className="br-link" onClick={openDashCoreSettings}>
          {status.connected ? t('ready') : t('not ready — check')}
        </button>
      </div>

      {error && <div className="br-exec__sim is-bad">{error}</div>}

      {(phase === 'idle' || phase === 'loading') && (
        <button type="button" className="br-btn br-btn--ghost" disabled={disabled || phase === 'loading'} onClick={() => void load()}>
          {phase === 'loading' ? t('Reading the wallets…') : t('Choose the sending address')}
        </button>
      )}

      {(phase === 'choose' || phase === 'drafting') && (
        <>
          {sources.length === 0 ? (
            <div className="br-muted">{t('No confirmed DASH on ordinary (X…) addresses in the open wallets.')}</div>
          ) : (
            <label className="br-address">
              <span className="br-side__label">{t('Pay from (refunds come back here)')}</span>
              <select className="br-input" value={picked} onChange={(e) => setPicked(e.target.value)}>
                {sources.map((s) => (
                  <option key={key(s)} value={key(s)} disabled={!enough(s)}>
                    {s.address} — {fromDuffs(s.total)} DASH
                    {s.label ? ` · ${s.label}` : ''}
                    {sources.some((o) => o.wallet !== s.wallet) ? ` · ${s.wallet || t('default wallet')}` : ''}
                    {enough(s) ? '' : ` · ${t('not enough')}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {source && source.skipped > 0 && (
            <div className="br-muted">{t('Masternode collateral (1000 / 4000 DASH coins) is never spent.')}</div>
          )}
          <div className="br-exec__actions">
            <button type="button" className="br-btn br-btn--ghost" disabled={phase === 'drafting'} onClick={() => void load()}>
              {t('Refresh')}
            </button>
            <button
              type="button"
              className="br-btn br-btn--primary"
              disabled={disabled || !source || !enough(source) || phase === 'drafting'}
              onClick={() => void prepare()}
            >
              {phase === 'drafting' ? t('Building…') : t('Build the transaction')}
            </button>
          </div>
        </>
      )}

      {(phase === 'review' || phase === 'sending') && draft && (
        <>
          <div className="br-exec__rows">
            <div>
              <span className="br-muted">{t('From')}</span>
              <strong className="br-mono">{draft.source.address}</strong>
              <span className="br-muted">
                {t('{n} coins, {total} DASH', { n: draft.inputs.length, total: fromDuffs(draft.inputs.reduce((s, u) => s + u.duffs, 0n)) })}
              </span>
            </div>
            <div>
              <span className="br-muted">{t('Outputs')}</span>
              <strong className="br-mono">
                {fromDuffs(draft.amount)} DASH → {draft.vault}
              </strong>
              <span className="br-muted br-mono">OP_RETURN {draft.memoHex}</span>
              {draft.change > 0n && (
                <span className="br-muted br-mono">
                  {t('change')} {fromDuffs(draft.change)} DASH → {draft.source.address}
                </span>
              )}
            </div>
            <div>
              <span className="br-muted">{t('Network fee')}</span>
              <strong>{fromDuffs(draft.fee)} DASH</strong>
              <span className="br-muted">{t('{rate} duffs per byte', { rate: draft.feeRate })}</span>
            </div>
          </div>
          <div className="br-ok">{t('✓ Dash Core decoded it: exactly these inputs and outputs, nothing else.')}</div>
          {draft.source.encrypted && (
            <label className="br-address">
              <span className="br-side__label">{t('Wallet password (unlocks it for one minute, not stored)')}</span>
              <input
                className="br-input"
                type="password"
                autoComplete="off"
                value={passphrase}
                disabled={phase === 'sending'}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
          )}
          <div className="br-exec__actions">
            <button type="button" className="br-btn br-btn--ghost" disabled={phase === 'sending'} onClick={() => setPhase('choose')}>
              {t('Back')}
            </button>
            <button
              type="button"
              className="br-btn br-btn--primary"
              disabled={disabled || phase === 'sending'}
              onClick={() => void send()}
            >
              {phase === 'sending' ? t('Signing and sending…') : t('Sign and send {amount} DASH', { amount: fromDuffs(draft.amount) })}
            </button>
          </div>
        </>
      )}

      {phase === 'sent' && <div className="br-ok">{t('Sent from Dash Core.')}</div>}
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { diag } from '../../diag';
import { openExternal } from '../../earn/openExternal';
import { QuoteRequest } from './types';
import { RankedRoute } from './search';
import { amountUSD } from './providers/common';
import { isNative } from './catalog';
import { ExecPlan, buildPlan } from './execute/plan';
import { SimulationResult, simulatePlan } from './execute/simulate';
import { RunProgress, RunStep, pendingApprovals, runPlan } from './execute/run';
import { Delivery, watchDelivery } from './execute/status';
import { explainRevert, readBalance } from './execute/balance';
import { SwapRecorder } from './history';
import { formatAmount, formatUSD, shortAddress } from './format';
import { tr, useT } from './i18n';

/** A plan older than this is rebuilt before signing — quotes go stale. */
const PLAN_TTL_MS = 60_000;
const LOSS_WARN_PCT = 1;
const LARGE_USD = 50_000;

type Phase = 'building' | 'review' | 'running' | 'delivering' | 'done' | 'refunded' | 'error';

const STEP_LABELS: Record<RunStep, string> = {
  reset: 'Reset the old approval to 0',
  approve: 'Approve exactly the amount',
  swap: 'Swap / bridge',
};

interface ExecutePanelProps {
  route: RankedRoute;
  req: QuoteRequest;
  onClose: (finished: boolean) => void;
}

export const ExecutePanel: React.FC<ExecutePanelProps> = (props) => {
  // Frozen at opening: a price refresh behind the dialog must not rebuild a
  // plan the user is in the middle of signing.
  const [{ route, req }] = useState(() => ({ route: props.route, req: props.req }));
  const { onClose } = props;
  const t = useT();
  const [phase, setPhase] = useState<Phase>('building');
  const [plan, setPlan] = useState<ExecPlan | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [progress, setProgress] = useState<Partial<Record<RunStep, RunProgress>>>({});
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [swapHash, setSwapHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [gasWarning, setGasWarning] = useState<string | null>(null);
  const [receiverAck, setReceiverAck] = useState(false);
  const abort = useRef(new AbortController());

  const outToken = isNative(req.toChain, req.toToken) ? null : (req.toToken.address as `0x${string}`);
  const inputUSD = amountUSD(req.amount, req.fromToken);

  const prepare = useCallback(async (): Promise<ExecPlan | null> => {
    setPhase('building');
    setError(null);
    setGasWarning(null);
    try {
      // Balances first: without the funds there is nothing to quote for real.
      const owner = req.fromAddress as `0x${string}`;
      const nativeInput = isNative(req.fromChain, req.fromToken);
      const [tokenBalance, nativeBalance] = await Promise.all([
        nativeInput ? Promise.resolve(0n) : readBalance(req.fromChain.id, req.fromToken.address as `0x${string}`, owner),
        readBalance(req.fromChain.id, null, owner),
      ]);
      const held = nativeInput ? nativeBalance : tokenBalance;
      if (held < req.amount) {
        throw new Error(
          tr('Not enough {symbol}: the wallet holds {held}, the swap needs {needed}.', {
            symbol: req.fromToken.symbol,
            held: formatAmount(held, req.fromToken.decimals),
            needed: formatAmount(req.amount, req.fromToken.decimals),
          })
        );
      }

      const built = await buildPlan(route, req, abort.current.signal);
      const nativeNeeded = (nativeInput ? req.amount : 0n) + built.extraValue;
      if (nativeBalance < nativeNeeded) {
        throw new Error(
          tr("Not enough {symbol} for the amount plus the service's fixed fee.", { symbol: req.fromChain.nativeSymbol })
        );
      }
      const gasNative =
        route.gasUSD && req.fromNativePriceUSD > 0 ? route.gasUSD / req.fromNativePriceUSD : 0;
      const spare = Number(nativeBalance - nativeNeeded) / 1e18;
      if (gasNative > 0 && spare < gasNative) {
        setGasWarning(
          tr('The wallet has {spare} {symbol} left for gas; about {needed} is needed.', {
            spare: spare.toFixed(5),
            symbol: req.fromChain.nativeSymbol,
            needed: gasNative.toFixed(5),
          })
        );
      }
      const [sim, approvals] = await Promise.all([
        simulatePlan(built, outToken, abort.current.signal),
        pendingApprovals(built),
      ]);
      setPlan(built);
      setSimulation(sim);
      setSteps([...approvals, 'swap']);
      setPhase('review');
      diag(
        'info',
        'BESTRATE',
        `plan ${built.providerName} ${built.via}: to ${built.tx.to}, spender ${built.spender ?? '-'}, ` +
          `min ${built.toAmountMin}, simulation ${sim.supported ? (sim.ok ? 'ok' : `failed: ${sim.error}`) : 'n/a'}`
      );
      return built;
    } catch (err: any) {
      if (abort.current.signal.aborted) return null;
      setError(err?.message ?? String(err));
      setPhase('error');
      diag('warn', 'BESTRATE', `plan ${route.providerName} refused: ${err?.message ?? err}`);
      return null;
    }
  }, [route, req, outToken]);

  useEffect(() => {
    void prepare();
    const controller = abort.current;
    return () => controller.abort();
  }, [prepare]);

  const confirm = async () => {
    const current = plan;
    if (!current) return;
    if (Date.now() - current.builtAt > PLAN_TTL_MS) {
      // Stale quote: rebuild and show the fresh numbers; the user confirms again.
      await prepare();
      return;
    }
    setPhase('running');
    const recorder = new SwapRecorder(current, req);
    try {
      const hash = await runPlan(current, req, (p) => {
        setProgress((prev) => ({ ...prev, [p.step]: p }));
        recorder.onProgress(p);
      });
      setSwapHash(hash);
      if (current.sameChain) {
        recorder.finish('done');
        setPhase('done');
        return;
      }
      setPhase('delivering');
      // Closing the window stops this watch; the history picks the transfer up later.
      const result = await watchDelivery(current.status, hash, setDelivery, abort.current.signal);
      if (result.state !== 'pending') recorder.finish(result.state, result.detail);
      setPhase(result.state === 'done' ? 'done' : result.state === 'refunded' ? 'refunded' : result.state === 'failed' ? 'error' : 'delivering');
      if (result.state === 'failed') {
        setError(tr("The transfer failed on {provider}'s side: {detail}", { provider: current.providerName, detail: result.detail ?? '' }));
      }
      diag('info', 'BESTRATE', `${current.providerName} delivery: ${result.state} ${result.detail ?? ''}`);
    } catch (err: any) {
      const message = err?.shortMessage ?? err?.message ?? String(err);
      const rejected = /reject|denied|cancel/i.test(message);
      const shown = rejected ? tr('Cancelled in the wallet. Nothing more was sent.') : explainRevert(message, req.fromToken.symbol);
      recorder.finish(rejected ? 'cancelled' : 'failed', shown);
      setError(shown);
      setPhase('error');
      diag('warn', 'BESTRATE', `${current.providerName} execution stopped: ${message}`);
    }
  };

  const explorer = req.fromChain.explorer;
  const txLink = (hash?: string) =>
    hash && explorer ? (
      <button type="button" className="br-link" onClick={() => openExternal(`${explorer}/tx/${hash}`)}>
        {shortAddress(hash)} ↗
      </button>
    ) : null;

  const outUSD = plan ? amountUSD(plan.toAmount, req.toToken) : 0;
  const lossPct = inputUSD > 0 && outUSD > 0 ? ((inputUSD - outUSD) / inputUSD) * 100 : 0;
  const needsLossAck = lossPct > LOSS_WARN_PCT;
  const simBlocks = !!simulation && simulation.supported && !simulation.ok;
  const otherReceiver = !!plan && plan.receiver.toLowerCase() !== plan.user.toLowerCase();
  const canConfirm =
    phase === 'review' && !simBlocks && (!needsLossAck || acceptLoss) && (!otherReceiver || receiverAck);
  const busy = phase === 'building' || phase === 'running';

  return (
    <div className="br-modal" role="dialog" aria-label={t('Confirm swap')} onMouseDown={() => !busy && onClose(phase === 'done')}>
      <div className="br-modal__panel br-exec" onMouseDown={(e) => e.stopPropagation()}>
        <div className="br-modal__head">
          <h3>
            {route.providerName} · {req.fromToken.symbol} → {req.toToken.symbol}
          </h3>
          <button
            type="button"
            className="br-icon-btn"
            aria-label={t('Close')}
            disabled={phase === 'running'}
            onClick={() => onClose(phase === 'done')}
          >
            ×
          </button>
        </div>

        {phase === 'building' && <div className="br-muted br-pad">{t('Building the transaction and simulating it…')}</div>}

        {plan && phase !== 'building' && (
          <div className="br-exec__rows">
            <div>
              <span className="br-muted">{t('You send')}</span>
              <strong>
                {formatAmount(plan.amount, req.fromToken.decimals)} {req.fromToken.symbol}
              </strong>
              <span className="br-muted">
                {t('{usd} on {chain}', { usd: formatUSD(inputUSD), chain: req.fromChain.name })}
              </span>
            </div>
            <div>
              <span className="br-muted">{t('You receive')}</span>
              <strong>
                ≈ {formatAmount(plan.toAmount, req.toToken.decimals)} {req.toToken.symbol}
              </strong>
              <span className="br-muted">
                {t('at least {amount} on {chain}', {
                  amount: formatAmount(plan.toAmountMin, req.toToken.decimals),
                  chain: req.toChain.name,
                })}
              </span>
            </div>
            <div>
              <span className="br-muted">{t('Receiver')}</span>
              <strong className="br-mono">{plan.receiver}</strong>
              {plan.receiver.toLowerCase() !== plan.user.toLowerCase() && (
                <span className="br-warn">{t('Not the sending wallet — check every character.')}</span>
              )}
            </div>
            <div>
              <span className="br-muted">{t('Contract')}</span>
              <strong className="br-mono">{plan.tx.to}</strong>
              <span className="br-ok">{t("✓ on {provider}'s published list", { provider: plan.providerName })}</span>
            </div>
            <div>
              <span className="br-muted">{t('Route')}</span>
              <strong>{plan.via}</strong>
              {plan.extraValue > 0n && (
                <span className="br-muted">
                  {t('plus a fee of {amount} {symbol} paid on top', {
                    amount: formatAmount(plan.extraValue, 18),
                    symbol: req.fromChain.nativeSymbol,
                  })}
                </span>
              )}
            </div>
          </div>
        )}

        {plan && (phase === 'review' || phase === 'running' || phase === 'delivering' || phase === 'done' || phase === 'refunded') && (
          <ol className="br-exec__steps">
            {steps.map((step) => {
              const p = progress[step];
              const state = !p ? 'todo' : p.state;
              return (
                <li key={step} className={`is-${state}`}>
                  <span>
                    {t(STEP_LABELS[step])}
                    {step === 'approve' && plan.spender && (
                      <span className="br-muted"> {t('to {address}', { address: shortAddress(plan.spender) })}</span>
                    )}
                  </span>
                  <span className="br-muted">
                    {state === 'wallet'
                      ? t('confirm in wallet…')
                      : state === 'pending'
                        ? t('waiting for the block…')
                        : state === 'done'
                          ? t('done')
                          : ''}
                  </span>
                  {txLink(p?.hash)}
                </li>
              );
            })}
          </ol>
        )}

        {phase === 'review' && simulation && (
          <div className={simulation.supported && !simulation.ok ? 'br-exec__sim is-bad' : 'br-exec__sim'}>
            {!simulation.supported &&
              t('Full simulation is not available on {chain}; the swap is dry-run right before it is sent.', {
                chain: req.fromChain.name,
              })}
            {simulation.supported && simulation.ok &&
              (simulation.received != null
                ? t('Simulated from your wallet: you receive {amount} {symbol}.', {
                    amount: formatAmount(simulation.received, req.toToken.decimals),
                    symbol: req.toToken.symbol,
                  })
                : t('Simulated from your wallet: approval and transaction go through.'))}
            {simBlocks &&
              t('Simulation failed — nothing will be sent: {reason}', {
                reason: explainRevert(simulation.error ?? 'reverted', req.fromToken.symbol),
              })}
          </div>
        )}
        {phase === 'review' && gasWarning && <div className="br-warn">{gasWarning}</div>}

        {phase === 'review' && otherReceiver && plan && (
          <label className="br-check br-warn">
            <input type="checkbox" checked={receiverAck} onChange={(e) => setReceiverAck(e.target.checked)} />
            <span>
              {t('I checked the receiver {address} on {chain} — funds sent there cannot be returned.', {
                address: shortAddress(plan.receiver),
                chain: req.toChain.name,
              })}
            </span>
          </label>
        )}
        {phase === 'review' && needsLossAck && (
          <label className="br-check br-warn">
            <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} />
            <span>{t('You receive {pct}% less than you send in value. I understand.', { pct: lossPct.toFixed(2) })}</span>
          </label>
        )}
        {phase === 'review' && inputUSD >= LARGE_USD && (
          <div className="br-muted">{t('Large amount: consider a small test swap on this route first.')}</div>
        )}

        {phase === 'delivering' && (
          <div className="br-exec__sim">
            {t('Sent. Waiting for {chain} to receive it{detail}… You can close this window; the transfer continues.', {
              chain: req.toChain.name,
              detail: delivery?.detail ? ` (${delivery.detail})` : '',
            })}
          </div>
        )}
        {phase === 'done' && (
          <div className="br-exec__sim br-ok">
            {t('Done — the funds have arrived.')} {txLink(swapHash ?? undefined)}
          </div>
        )}
        {phase === 'refunded' && (
          <div className="br-exec__sim br-warn">{t('The transfer was not filled and was refunded to your wallet.')}</div>
        )}
        {phase === 'error' && error && <div className="br-exec__sim is-bad">{error}</div>}

        <div className="br-exec__actions">
          {phase === 'review' && (
            <button type="button" className="br-btn br-btn--primary" disabled={!canConfirm} onClick={() => void confirm()}>
              {steps.length > 1 ? t('Approve and swap ({count} transactions)', { count: steps.length }) : t('Swap')}
            </button>
          )}
          {phase === 'error' && (
            <button type="button" className="br-btn br-btn--ghost" onClick={() => void prepare()}>
              {t('Try again')}
            </button>
          )}
          <button
            type="button"
            className="br-btn br-btn--ghost"
            disabled={phase === 'running'}
            onClick={() => onClose(phase === 'done')}
          >
            {phase === 'done' || phase === 'delivering' || phase === 'refunded' ? t('Close') : t('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

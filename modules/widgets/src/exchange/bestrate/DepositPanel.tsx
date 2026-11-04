import React, { useCallback, useEffect, useRef, useState } from 'react';
import { diag } from '../../diag';
import { openExternal } from '../../earn/openExternal';
import { QuoteRequest } from './types';
import { RankedRoute } from './search';
import { amountUSD, humanAmount } from './providers/common';
import { MayaDeposit, mayaDeposit } from './providers/maya';
import { formatAmount, formatDuration, formatUSD } from './format';
import { tr, useT } from './i18n';

const LARGE_USD = 50_000;

/** Chains whose Core wallet console can build the OP_RETURN transaction. */
const CORE_WALLETS: Record<string, string> = { dash: 'Dash Core', btc: 'Bitcoin Core' };

/**
 * Console commands for a Core wallet: a raw transaction paying the vault with
 * the memo as an OP_RETURN output, funded at the vault's fee rate, signed,
 * checked and sent. Each step takes the hex printed by the one before.
 */
function coreCommands(deposit: MayaDeposit, amount: string): string[] {
  // sats/byte → coins per kB, the unit Core's feeRate option takes.
  const feeRate = ((Math.max(deposit.gasRate, 1) * 1000) / 1e8).toFixed(8);
  return [
    `createrawtransaction '[]' '{"${deposit.vault}":${amount},"data":"${deposit.memoHex}"}'`,
    `fundrawtransaction ${tr('<hex from step {n}>', { n: 1 })} '{"feeRate":${feeRate}}'`,
    `signrawtransactionwithwallet ${tr('<hex from step {n}>', { n: 2 })}`,
    `decoderawtransaction ${tr('<hex from step {n}>', { n: 3 })}`,
    `sendrawtransaction ${tr('<hex from step {n}>', { n: 3 })}`,
  ];
}

const Copy: React.FC<{ value: string }> = ({ value }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="br-link"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? t('copied') : t('copy')}
    </button>
  );
};

interface DepositPanelProps {
  route: RankedRoute;
  req: QuoteRequest;
  onClose: () => void;
}

/**
 * Maya deposit by hand for UTXO chains: no wallet connection — the user sends
 * from their own wallet to Maya's vault with the memo. A fresh quote is taken
 * on opening, since the vault and the price limit are valid for minutes only.
 */
export const DepositPanel: React.FC<DepositPanelProps> = (props) => {
  const [{ route, req }] = useState(() => ({ route: props.route, req: props.req }));
  const { onClose } = props;
  const t = useT();
  const [deposit, setDeposit] = useState<MayaDeposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [txid, setTxid] = useState('');
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    setDeposit(null);
    try {
      const found = await mayaDeposit(req, route.maya?.streaming ?? false, controller.signal);
      if (controller.signal.aborted) return;
      setDeposit(found);
      diag(
        'info',
        'BESTRATE',
        `Maya deposit ${req.fromToken.symbol} → ${req.toToken.symbol} (${req.toChain.name}): vault ${found.vault}, memo ${found.memo}`
      );
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setError(err?.message ?? String(err));
      diag('warn', 'BESTRATE', `Maya deposit not prepared: ${err?.message ?? err}`);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [req, route]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      abort.current?.abort();
    };
  }, [load]);

  const secondsLeft = deposit ? Math.floor(deposit.expiry - now / 1000) : 0;
  const expired = !!deposit && deposit.expiry > 0 && secondsLeft <= 0;
  const amount = humanAmount(req.amount, req.fromToken.decimals);
  const inputUSD = amountUSD(req.amount, req.fromToken);
  const core = CORE_WALLETS[req.fromChain.key];
  const trackable = /^[0-9a-fA-F]{64}$/.test(txid.trim());

  return (
    <div className="br-modal" role="dialog" aria-label={t('Deposit to Maya')} onMouseDown={onClose}>
      <div className="br-modal__panel br-exec br-deposit" onMouseDown={(e) => e.stopPropagation()}>
        <div className="br-modal__head">
          <h3>
            {route.providerName} · {req.fromToken.symbol} → {req.toToken.symbol}
          </h3>
          <button type="button" className="br-icon-btn" aria-label={t('Close')} onClick={onClose}>
            ×
          </button>
        </div>

        {loading && <div className="br-muted br-pad">{t("Getting a fresh quote and Maya's current vault…")}</div>}
        {error && <div className="br-exec__sim is-bad">{error}</div>}

        {deposit && (
          <>
            <div className={`br-exec__rows${expired ? ' is-expired' : ''}`}>
              <div>
                <span className="br-muted">{t('Send exactly')}</span>
                <strong className="br-mono">
                  {amount} {req.fromToken.symbol} <Copy value={amount} />
                </strong>
                <span className="br-muted">
                  {t('{usd} from your own {chain} wallet; the network fee is paid on top', {
                    usd: formatUSD(inputUSD),
                    chain: req.fromChain.name,
                  })}
                </span>
              </div>
              <div>
                <span className="br-muted">{t("To Maya's vault")}</span>
                <strong className="br-mono">
                  {deposit.vault} <Copy value={deposit.vault} />
                </strong>
                <span className="br-ok">{t('✓ the vault Maya publishes right now, not halted')}</span>
              </div>
              <div>
                <span className="br-muted">{t('With the memo (OP_RETURN)')}</span>
                <strong className="br-mono">
                  {deposit.memo} <Copy value={deposit.memo} />
                </strong>
                <span className="br-muted br-mono">
                  hex {deposit.memoHex} <Copy value={deposit.memoHex} />
                </span>
              </div>
              <div>
                <span className="br-muted">{t('You receive')}</span>
                <strong>
                  ≈ {formatAmount(deposit.expectedOut, req.toToken.decimals)} {req.toToken.symbol}
                </strong>
                <span className="br-muted">
                  {t('at least {amount} on {chain}, to', {
                    amount: formatAmount(deposit.minOut, req.toToken.decimals),
                    chain: req.toChain.name,
                  })}{' '}
                  <span className="br-mono">{req.toAddress}</span>
                </span>
              </div>
              <div>
                <span className="br-muted">{t('Timing')}</span>
                <strong>
                  {expired ? t('Quote expired') : t('Send within {time}', { time: formatDuration(secondsLeft) })}
                </strong>
                <span className="br-muted">
                  {t('then about {time} to arrive{parts}; fee rate at least {rate} {units}', {
                    time: formatDuration(deposit.durationSec),
                    parts:
                      deposit.streamingParts > 1 ? ` (${t('{count} sub-swaps', { count: deposit.streamingParts })})` : '',
                    rate: deposit.gasRate,
                    units: deposit.gasRateUnits,
                  })}
                </span>
              </div>
            </div>

            {deposit.capacityWarning && <div className="br-exec__sim is-bad">{deposit.capacityWarning}</div>}

            <ul className="br-deposit__rules">
              <li>
                <strong>{t('The memo must be in the transaction.')}</strong>{' '}
                {t(
                  'Without it Maya cannot tell what to do and refunds the deposit minus fees. A wallet that cannot add OP_RETURN data will not work.'
                )}
              </li>
              <li>
                <strong>{t('Send from your own wallet, not from an exchange.')}</strong>{' '}
                {t(
                  'Refunds — when the price moves past your {pct}% slippage or the memo is wrong — go back to the sending address.',
                  { pct: req.slippageBps / 100 }
                )}
              </li>
              <li>
                <strong>{t('Send once, before the timer runs out.')}</strong>{' '}
                {t('The vault changes from time to time; never reuse this address later — open a new deposit instead.')}
              </li>
              {inputUSD >= LARGE_USD && <li>{t('Large amount: send a small test deposit first.')}</li>}
            </ul>

            {core && !expired && (
              <details className="br-deposit__core">
                <summary>{t('Commands for the {wallet} console (Window → Console)', { wallet: core })}</summary>
                <ol>
                  {coreCommands(deposit, amount).map((command, i) => (
                    <li key={i}>
                      <code className="br-mono">{command}</code> <Copy value={command} />
                    </li>
                  ))}
                </ol>
                <p className="br-muted">
                  {t(
                    'Unlock the wallet first if it is encrypted (walletpassphrase). In step 4 check that one output pays {amount} {symbol} to {vault} and one is nulldata (OP_RETURN) with the memo hex; only then send.',
                    { amount, symbol: req.fromToken.symbol, vault: deposit.vault }
                  )}
                </p>
              </details>
            )}

            <label className="br-address">
              <span className="br-side__label">{t('After sending: your transaction ID')}</span>
              <input
                className="br-input br-mono"
                placeholder={t('txid, to follow the swap on MayaScan')}
                spellCheck={false}
                value={txid}
                onChange={(e) => setTxid(e.target.value)}
              />
            </label>
          </>
        )}

        <div className="br-exec__actions">
          {deposit && (
            <button
              type="button"
              className="br-btn br-btn--ghost"
              disabled={!trackable}
              onClick={() => openExternal(`https://www.mayascan.org/tx/${txid.trim().toUpperCase()}`)}
            >
              {t('Track on MayaScan')} ↗
            </button>
          )}
          {(expired || error) && (
            <button type="button" className="br-btn br-btn--primary" onClick={() => void load()}>
              {t('New quote')}
            </button>
          )}
          <button type="button" className="br-btn br-btn--ghost" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </div>
  );
};

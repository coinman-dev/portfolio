import React, { useEffect, useState } from 'react';
import { openExternal } from '../../earn/openExternal';
import { SwapRecord, SwapStatus, loadHistory, onHistoryChange, resumePending } from './history';
import { formatAmount, shortAddress } from './format';

const STATUS_LABELS: Record<SwapStatus, string> = {
  sending: 'Sending',
  pending: 'In progress',
  done: 'Completed',
  refunded: 'Refunded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STEP_LABELS: Record<string, string> = { reset: 'reset', approve: 'approve', swap: 'swap' };

/** The services' own pages that follow a transfer across chains. */
function trackerUrl(record: SwapRecord): string | null {
  const swap = record.txs.find((tx) => tx.step === 'swap');
  if (record.statusRef.kind === 'lifi' && swap) return `https://scan.li.fi/tx/${swap.hash}`;
  if (record.statusRef.kind === 'debridge') {
    return `https://app.debridge.finance/order?orderId=${record.statusRef.orderId}`;
  }
  return null;
}

function HistoryRow({ record }: { record: SwapRecord }) {
  const tracker = trackerUrl(record);
  const toOther = record.receiver.toLowerCase() !== record.user.toLowerCase();
  return (
    <div className="br-hist__row">
      <div className="br-hist__top">
        <span className="br-muted">{new Date(record.createdAt).toLocaleString()}</span>
        <span className={`br-hist__status is-${record.status}`}>{STATUS_LABELS[record.status]}</span>
      </div>
      <div className="br-hist__main">
        <strong>
          {formatAmount(BigInt(record.from.amount), record.from.decimals)} {record.from.symbol}
        </strong>{' '}
        <span className="br-muted">{record.from.chainName}</span> →{' '}
        <strong>
          ≈ {formatAmount(BigInt(record.to.expected), record.to.decimals)} {record.to.symbol}
        </strong>{' '}
        <span className="br-muted">{record.to.chainName}</span>
      </div>
      <div className="br-muted">
        {record.providerName} via {record.via}
        {toOther && ` · to ${shortAddress(record.receiver)}`}
        {' · '}minimum {formatAmount(BigInt(record.to.min), record.to.decimals)} {record.to.symbol}
      </div>
      <div className="br-hist__links">
        {record.txs.map((tx) =>
          record.explorer ? (
            <button
              key={tx.step}
              type="button"
              className="br-link"
              onClick={() => openExternal(`${record.explorer}/tx/${tx.hash}`)}
            >
              {STEP_LABELS[tx.step] ?? tx.step} ↗
            </button>
          ) : (
            <span key={tx.step} className="br-mono">
              {STEP_LABELS[tx.step] ?? tx.step} {shortAddress(tx.hash)}
            </span>
          )
        )}
        {tracker && (
          <button type="button" className="br-link" onClick={() => openExternal(tracker)}>
            track transfer ↗
          </button>
        )}
      </div>
      {record.detail && <div className={record.status === 'done' ? 'br-muted' : 'br-warn'}>{record.detail}</div>}
    </div>
  );
}

export const HistoryPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [records, setRecords] = useState<SwapRecord[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const reload = () => void loadHistory().then(setRecords);
    reload();
    const off = onHistoryChange(reload);
    // Transfers still on their way when the app was closed get followed again.
    void resumePending(controller.signal);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      controller.abort();
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="br-modal" role="dialog" aria-label="Swap history" onMouseDown={onClose}>
      <div className="br-modal__panel br-hist" onMouseDown={(e) => e.stopPropagation()}>
        <div className="br-modal__head">
          <h3>Swap history{records ? ` (${records.length})` : ''}</h3>
          <button type="button" className="br-icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="br-hist__list">
          {!records && <div className="br-muted br-pad">Loading…</div>}
          {records && !records.length && (
            <div className="br-muted br-pad">No swaps yet. Swaps signed here are listed with their transactions.</div>
          )}
          {records?.map((record) => <HistoryRow key={record.id} record={record} />)}
        </div>
        <div className="br-muted br-hist__note">Stored on this computer in data/exchange-history.json.</div>
      </div>
    </div>
  );
};

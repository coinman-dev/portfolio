import React, { useEffect, useState } from 'react';
import { openExternal } from '../../earn/openExternal';
import { shortAddress } from '../bestrate/format';
import { txUrl } from './chains';
import { RevokeRecord, RevokeStatus, loadRevokeHistory } from './history';

const STATUS_LABELS: Record<RevokeStatus, string> = {
  pending: 'In progress',
  done: 'Revoked',
  failed: 'Failed',
};

function Row({ record }: { record: RevokeRecord }) {
  const link = record.tx ? txUrl(record.family, record.chainId, record.tx) : '';
  return (
    <div className="br-hist__row">
      <div className="br-hist__top">
        <span className="br-muted">{new Date(record.createdAt).toLocaleString()}</span>
        <span className={`br-hist__status is-${record.status}`}>{STATUS_LABELS[record.status]}</span>
      </div>
      <div className="br-hist__main">
        <strong>{record.chainName}</strong>{' '}
        {record.items.map((item, i) => (
          <span key={i}>
            {i > 0 && ', '}
            {item.symbol} <span className="br-muted">→ {item.spenderName ?? shortAddress(item.spender)}</span>
          </span>
        ))}
      </div>
      <div className="br-hist__links">
        {link ? (
          <button type="button" className="br-link" onClick={() => openExternal(link)}>
            transaction ↗
          </button>
        ) : (
          record.tx && <span className="br-mono">{shortAddress(record.tx)}</span>
        )}
        <span className="br-muted">from {shortAddress(record.owner)}</span>
      </div>
      {record.detail && <div className={record.status === 'done' ? 'br-muted' : 'br-warn'}>{record.detail}</div>}
    </div>
  );
}

export const RevokeHistory: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [records, setRecords] = useState<RevokeRecord[] | null>(null);

  useEffect(() => {
    void loadRevokeHistory().then(setRecords);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="br-modal" role="dialog" aria-label="Revoke history" onMouseDown={onClose}>
      <div className="br-modal__panel br-hist" onMouseDown={(e) => e.stopPropagation()}>
        <div className="br-modal__head">
          <h3>Revoke history{records ? ` (${records.length})` : ''}</h3>
          <button type="button" className="br-icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="br-hist__list">
          {!records && <div className="br-muted br-pad">Loading…</div>}
          {records && !records.length && <div className="br-muted br-pad">Nothing revoked from here yet.</div>}
          {records?.map((record) => <Row key={record.id} record={record} />)}
        </div>
        <div className="br-muted br-hist__note">Stored on this computer in data/revoke-history.json.</div>
      </div>
    </div>
  );
};

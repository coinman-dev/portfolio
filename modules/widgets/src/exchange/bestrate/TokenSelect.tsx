import React, { useEffect, useMemo, useState } from 'react';
import { BrChain, BrToken } from './types';
import { fetchToken, fetchTokens } from './catalog';
import { FAMILY_NAMES, formatUSD, shortAddress } from './format';

const MAX_ROWS = 150;

interface TokenSelectProps {
  title: string;
  chains: BrChain[];
  chainId: number;
  onSelect: (chain: BrChain, token: BrToken) => void;
  onClose: () => void;
}

export function Logo({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="br-logo br-logo--empty">{alt.slice(0, 1)}</span>;
  return <img className="br-logo" src={src} alt="" onError={() => setFailed(true)} />;
}

export const TokenSelect: React.FC<TokenSelectProps> = ({ title, chains, chainId, onSelect, onClose }) => {
  const [activeChainId, setActiveChainId] = useState(chainId);
  const [chainQuery, setChainQuery] = useState('');
  const [tokenQuery, setTokenQuery] = useState('');
  const [tokens, setTokens] = useState<BrToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [pasted, setPasted] = useState<BrToken | null>(null);

  const chain = chains.find((c) => c.id === activeChainId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTokens([]);
    fetchTokens(activeChainId)
      .then((list) => !cancelled && setTokens(list))
      .catch(() => !cancelled && setTokens([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeChainId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shownChains = useMemo(() => {
    const q = chainQuery.trim().toLowerCase();
    return q ? chains.filter((c) => c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)) : chains;
  }, [chains, chainQuery]);

  const query = tokenQuery.trim().toLowerCase();
  const shownTokens = useMemo(() => {
    if (!query) return tokens.filter((t) => t.status !== 'flagged').slice(0, MAX_ROWS);
    const exact = tokens.filter((t) => t.address.toLowerCase() === query);
    if (exact.length) return exact;
    return tokens
      .filter((t) => t.status !== 'flagged')
      .filter((t) => t.symbol.toLowerCase().includes(query) || t.name.toLowerCase().includes(query))
      .slice(0, MAX_ROWS);
  }, [tokens, query]);

  // A pasted contract address that is not on LI.FI's list.
  useEffect(() => {
    setPasted(null);
    if (!chain || query.length < 26 || shownTokens.length) return;
    let cancelled = false;
    fetchToken(chain.id, tokenQuery.trim())
      .then((token) => !cancelled && setPasted(token))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chain, query, tokenQuery, shownTokens.length]);

  const rows = pasted ? [pasted] : shownTokens;

  return (
    <div className="br-modal" role="dialog" aria-label={title} onMouseDown={onClose}>
      <div className="br-modal__panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="br-modal__head">
          <h3>{title}</h3>
          <button type="button" className="br-icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="br-select">
          <div className="br-select__chains">
            <input
              className="br-input"
              placeholder="Search network"
              value={chainQuery}
              onChange={(e) => setChainQuery(e.target.value)}
            />
            <div className="br-select__list">
              {shownChains.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`br-select__chain${c.id === activeChainId ? ' is-active' : ''}`}
                  onClick={() => {
                    setActiveChainId(c.id);
                    setTokenQuery('');
                  }}
                >
                  <Logo src={c.logo} alt={c.name} />
                  <span>{c.name}</span>
                  {c.type !== 'EVM' && <span className="br-tag">{FAMILY_NAMES[c.type]}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="br-select__tokens">
            <input
              className="br-input"
              placeholder="Search by name, symbol or paste an address"
              value={tokenQuery}
              autoFocus
              onChange={(e) => setTokenQuery(e.target.value)}
            />
            <div className="br-select__list">
              {loading && <div className="br-muted br-pad">Loading tokens…</div>}
              {!loading && !rows.length && <div className="br-muted br-pad">No tokens found.</div>}
              {chain &&
                rows.map((t) => (
                  <button
                    key={t.address}
                    type="button"
                    className="br-select__token"
                    onClick={() => onSelect(chain, t)}
                  >
                    <Logo src={t.logo} alt={t.symbol} />
                    <span className="br-select__token-main">
                      <span className="br-select__token-symbol">
                        {t.symbol}
                        {t.status === 'unverified' && <span className="br-tag br-tag--warn">unverified</span>}
                        {t.status === 'flagged' && <span className="br-tag br-tag--bad">flagged</span>}
                      </span>
                      <span className="br-muted">
                        {t.name} · {shortAddress(t.address)}
                      </span>
                    </span>
                    <span className="br-muted">{t.priceUSD ? formatUSD(t.priceUSD) : ''}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

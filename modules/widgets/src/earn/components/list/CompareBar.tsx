import React from 'react';

interface CompareBarProps {
  count: number;
  onClear: () => void;
  onCompare: () => void;
}

export const CompareBar: React.FC<CompareBarProps> = ({ count, onClear, onCompare }) => {
  if (count < 1) return null;
  return (
    <div className="y-compare-bar">
      <div className="y-compare-bar__inner">
        <div className="y-compare-bar__text">
          {count === 1 ? 'Selected 1 vault. Select one more to compare' : `Selected ${count} vaults`}
        </div>
        <div className="y-compare-bar__actions">
          <button type="button" className="y-btn y-btn--ghost y-btn--small" onClick={onClear}>
            Clear
          </button>
          <button
            type="button"
            className="y-btn y-btn--light y-btn--small"
            disabled={count < 2}
            onClick={onCompare}
          >
            {`Compare (${count})`}
          </button>
        </div>
      </div>
    </div>
  );
};

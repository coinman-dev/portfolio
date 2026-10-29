import React from 'react';
import { useT } from '../../i18n';
import { plural } from '../../i18n/plural';

interface CompareBarProps {
  count: number;
  onClear: () => void;
  onCompare: () => void;
}

export const CompareBar: React.FC<CompareBarProps> = ({ count, onClear, onCompare }) => {
  const t = useT();
  if (count < 1) return null;
  const selectedKey = plural(
    count,
    'Selected {count} vault_one',
    'Selected {count} vaults_few',
    'Selected {count} vaults_many'
  );
  return (
    <div className="y-compare-bar">
      <div className="y-compare-bar__inner">
        <div className="y-compare-bar__text">
          {count === 1
            ? t('Selected 1 vault. Select one more to compare')
            : t(selectedKey, { count })}
        </div>
        <div className="y-compare-bar__actions">
          <button type="button" className="y-btn y-btn--ghost y-btn--small" onClick={onClear}>
            {t('Clear')}
          </button>
          <button
            type="button"
            className="y-btn y-btn--light y-btn--small"
            disabled={count < 2}
            onClick={onCompare}
          >
            {t('Compare ({count})', { count })}
          </button>
        </div>
      </div>
    </div>
  );
};

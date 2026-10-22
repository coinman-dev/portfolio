import React from 'react';
import { useT } from '../../i18n';

interface VaultsListEmptyProps {
  currentSearch: string;
  isLoading: boolean;
  onReset: () => void;
}

export const VaultsListEmpty: React.FC<VaultsListEmptyProps> = ({
  currentSearch,
  isLoading,
  onReset,
}) => {
  const t = useT();
  if (isLoading) {
    return (
      <output aria-live="polite" className="y-list-loading">
        <b>{t('Fetching Vaults:')}</b>
        <div className="y-list-loading__spinner">
          <span className="y-loader" />
        </div>
      </output>
    );
  }

  if (currentSearch) {
    return (
      <div className="y-list-empty">
        <b>{t('No vaults found')}</b>
        <p>{t('The vault "{query}" does not exist', { query: currentSearch })}</p>
      </div>
    );
  }

  return (
    <div className="y-list-empty">
      <b>{t('No vaults found')}</b>
      <p>{t('No vaults found that match your filters.')}</p>
      <button type="button" className="y-btn y-btn--light y-list-empty__action" onClick={onReset}>
        {t('Search all vaults')}
      </button>
    </div>
  );
};

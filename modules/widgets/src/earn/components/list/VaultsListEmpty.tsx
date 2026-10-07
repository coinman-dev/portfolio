import React from 'react';

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
  if (isLoading) {
    return (
      <output aria-live="polite" className="y-list-loading">
        <b>Fetching Vaults…</b>
        <div className="y-list-loading__spinner">
          <span className="y-loader" />
        </div>
      </output>
    );
  }

  if (currentSearch) {
    return (
      <div className="y-list-empty">
        <b>No vaults found</b>
        <p>{`The vault "${currentSearch}" does not exist`}</p>
      </div>
    );
  }

  return (
    <div className="y-list-empty">
      <b>No vaults found</b>
      <p>No vaults found that match your filters.</p>
      <button type="button" className="y-btn y-btn--light y-list-empty__action" onClick={onReset}>
        Search all vaults
      </button>
    </div>
  );
};

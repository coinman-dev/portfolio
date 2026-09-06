import React from 'react';
import { ChevronLeft } from '../ui/icons';
import { VAULTS_PER_PAGE } from './VaultsListView';

interface VaultsPaginationProps {
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** First page, last page and a window around the current one; gaps get an ellipsis. */
function pageWindow(currentPage: number, totalPages: number): number[] {
  return Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2
  );
}

export const VaultsPagination: React.FC<VaultsPaginationProps> = ({
  currentPage,
  totalPages,
  total,
  onPageChange,
}) => {
  const first = (currentPage - 1) * VAULTS_PER_PAGE + 1;
  const last = Math.min(currentPage * VAULTS_PER_PAGE, total);
  const pages = pageWindow(currentPage, totalPages);

  return (
    <nav className="y-pager" aria-label="Vault list pages">
      <p className="y-pager__info">{`Showing ${first}–${last} of ${total} vaults`}</p>

      <div className="y-pager__controls">
        <button
          type="button"
          className="y-pager__btn y-pager__btn--step"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft size={16} />
        </button>

        {pages.map((page, index) => (
          <React.Fragment key={page}>
            {index > 0 && page - pages[index - 1] > 1 && (
              <span className="y-pager__dots" aria-hidden="true">
                …
              </span>
            )}
            <button
              type="button"
              className={`y-pager__btn${page === currentPage ? ' is-active' : ''}`}
              aria-label={`Page ${page}`}
              aria-current={page === currentPage ? 'page' : undefined}
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          </React.Fragment>
        ))}

        <button
          type="button"
          className="y-pager__btn y-pager__btn--step y-pager__btn--next"
          aria-label="Next page"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronLeft size={16} />
        </button>
      </div>
    </nav>
  );
};

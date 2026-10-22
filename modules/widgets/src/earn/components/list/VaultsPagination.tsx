import React from 'react';
import { ChevronLeft } from '../ui/icons';
import { VAULTS_PER_PAGE } from './VaultsListView';
import { useT } from '../../i18n';
import { plural } from '../../i18n/plural';

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
  const t = useT();
  const first = (currentPage - 1) * VAULTS_PER_PAGE + 1;
  const last = Math.min(currentPage * VAULTS_PER_PAGE, total);
  const pages = pageWindow(currentPage, totalPages);
  const showingKey = plural(
    total,
    'Showing {first}-{last} of {total} vault_one',
    'Showing {first}-{last} of {total} vaults_few',
    'Showing {first}-{last} of {total} vaults_many'
  );

  return (
    <nav className="y-pager" aria-label={t('Vault list pages')}>
      <p className="y-pager__info">{t(showingKey, { first, last, total })}</p>

      <div className="y-pager__controls">
        <button
          type="button"
          className="y-pager__btn y-pager__btn--step"
          aria-label={t('Previous page')}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft size={16} />
        </button>

        {pages.map((page, index) => (
          <React.Fragment key={page}>
            {index > 0 && page - pages[index - 1] > 1 && (
              <span className="y-pager__dots" aria-hidden="true">
                {'\u2026'}
              </span>
            )}
            <button
              type="button"
              className={`y-pager__btn${page === currentPage ? ' is-active' : ''}`}
              aria-label={t('Page {page}', { page })}
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
          aria-label={t('Next page')}
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronLeft size={16} />
        </button>
      </div>
    </nav>
  );
};

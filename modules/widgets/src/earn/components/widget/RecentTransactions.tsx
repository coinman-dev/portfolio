import React from 'react';
import { YearnVault } from '../../types';
import {
  activityAmounts,
  activityLabels,
  activityTitle,
  formatActivityAmount,
  formatActivityDate,
} from '../../activity';
import { useKongVaultIndex, useVaultRecentActivity } from '../../hooks/useActivity';
import { openTransaction, shortTxHash } from '../activity/ActivityRow';
import { useT } from '../../i18n';

interface RecentTransactionsProps {
  address: string;
  vault: YearnVault;
  onOpenActivity?: () => void;
}

/** "Wallet -> Transactions" in the vault widget. */
export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  address,
  vault,
  onOpenActivity,
}) => {
  const t = useT();
  const { entries, isLoading } = useVaultRecentActivity(address, vault);
  const kong = useKongVaultIndex();

  return (
    <section className="y-wallet__section">
      <div className="y-wallet__section-head">
        <h4 className="y-wallet__section-title">{t('Recent transactions')}</h4>
        {onOpenActivity && (
          <button type="button" className="y-act-all" onClick={onOpenActivity}>
            {t('All activity')}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="y-wallet__muted">{t('Loading transactions...')}</p>
      ) : entries.length === 0 ? (
        <p className="y-wallet__muted">{t('No recent transactions.')}</p>
      ) : (
        <ul className="y-act-recent">
          {entries.map((entry, index) => {
            const labels = activityLabels(entry, kong.data);
            const amounts = activityAmounts(entry, labels.shareSymbol)
              .map((line) => `${line.sign}${formatActivityAmount(line.value)} ${line.symbol}`.trim())
              .join(' \u2192 ');
            return (
              <li className="y-act-recent__row" key={`${entry.txHash}:${index}`}>
                <div className="y-act-recent__head">
                  <span className="y-act-recent__title">{activityTitle(entry)}</span>
                  <span className="y-act-recent__status">{t('Success')}</span>
                </div>
                <span className="y-act-recent__amounts">{amounts}</span>
                <span className="y-act-recent__meta">
                  {formatActivityDate(entry.timestamp)}
                  {' \u00B7 '}
                  <button
                    type="button"
                    className="y-act-link y-act-mono"
                    onClick={() => openTransaction(entry)}
                  >
                    {shortTxHash(entry.txHash)}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

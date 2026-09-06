import React from 'react';
import { YearnVault } from '../../types';
import { RiskScoreTag } from '../shared/RiskScoreTag';
import { SectionCard } from './SectionCard';

export const RISK_SECTION_TEXT =
  "This risk score determines what strategies can be added to this vault. Only strategies with " +
  "overall risk score values equal or lower to the vault risk score are allowed. The strategy risk " +
  "scores are calculated based on multiple factors including the strategy's complexity, exposure to " +
  'potential losses, and reliance on external protocols. A score of 1 represents the highest ' +
  'security, while 5 indicates the lowest.';

interface VaultRiskSectionProps {
  vault: YearnVault;
  sectionRef?: React.Ref<HTMLElement>;
}

export const VaultRiskSection: React.FC<VaultRiskSectionProps> = ({ vault, sectionRef }) => {
  const level = Math.max(0, Math.min(5, vault.info?.riskLevel ?? 0));

  return (
    <SectionCard id="risk" title="Risk" sectionRef={sectionRef}>
      <div className="y-vd-risk__score">
        <span className="y-vd-risk__title">Overall Risk Score</span>
        <span className="y-vd-risk__value">
          <b className="y-vd-risk__level">{level}</b>
          <span className="y-vd-risk__max"> / 5</span>
          <RiskScoreTag riskLevel={level} />
        </span>
      </div>
      <p className="y-vd-risk__text">{RISK_SECTION_TEXT}</p>
    </SectionCard>
  );
};

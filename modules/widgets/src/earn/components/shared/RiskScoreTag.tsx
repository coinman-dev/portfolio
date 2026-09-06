import React from 'react';

const RISK_COLORS = ['transparent', '#63C532', '#F8A908', '#F8A908', '#C73203', '#C73203'];

export const RISK_TOOLTIP =
  "This reflects the vault's security, with 1 being most secure and 5 least secure, based on strategy complexity, loss exposure, and external dependencies.";

interface RiskScoreTagProps {
  riskLevel: number;
  className?: string;
}

/** Small 40x12 risk gauge, matching yearn.fi's score bar. */
export const RiskScoreTag: React.FC<RiskScoreTagProps> = ({ riskLevel, className }) => {
  const level = riskLevel < 0 ? 0 : riskLevel > 5 ? 5 : riskLevel;
  return (
    <div
      className={`y-risk-tag${className ? ` ${className}` : ''}`}
      title={`${level} / 5 : ${RISK_TOOLTIP}`}
    >
      <div className="y-risk-tag__track">
        <div
          className="y-risk-tag__fill"
          style={{ backgroundColor: RISK_COLORS[level], width: `${(level / 5) * 100}%` }}
        />
      </div>
    </div>
  );
};

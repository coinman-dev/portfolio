import React from 'react';
import { YearnVault } from '../../types';
import { ChevronDown } from '../ui/icons';
import { VaultAvatar } from '../list/VaultAvatar';

const PERCENTS = [25, 50, 75];

interface AmountInputProps {
  vault: YearnVault;
  value: string;
  onChange: (value: string) => void;
  onPercent: (percent: number) => void;
  usdValue: string;
  balanceLabel: React.ReactNode;
  disabled?: boolean;
  symbol: string;
}

export const AmountInput: React.FC<AmountInputProps> = ({
  vault,
  value,
  onChange,
  onPercent,
  usdValue,
  balanceLabel,
  disabled,
  symbol,
}) => (
  <div className="y-amount">
    <div className="y-amount__top">
      <span className="y-amount__label">Amount</span>
      <div className="y-amount__percents">
        {PERCENTS.map((percent) => (
          <button
            key={percent}
            type="button"
            className="y-amount__percent"
            disabled={disabled}
            onClick={() => onPercent(percent)}
          >
            {`${percent}%`}
          </button>
        ))}
        <button
          type="button"
          className="y-amount__percent"
          disabled={disabled}
          onClick={() => onPercent(100)}
        >
          Max
        </button>
      </div>
    </div>

    <div className="y-amount__row">
      <input
        type="text"
        inputMode="decimal"
        placeholder="0.00"
        className="y-amount__input"
        aria-label={`Amount in ${symbol}`}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value.replace(/,/g, '.');
          if (/^\d*\.?\d*$/.test(next)) onChange(next);
        }}
      />
      <button type="button" className="y-token-select" disabled>
        <VaultAvatar
          icon={vault.token?.icon}
          tokenIcon={vault.token?.icon}
          symbol={symbol}
          chainId={vault.chainID}
          tokenAddress={vault.token?.address}
          size={28}
        />
        <span className="y-token-select__symbol">{symbol}</span>
        <ChevronDown size={16} />
      </button>
    </div>

    <div className="y-amount__bottom">
      <span className="y-amount__usd">{usdValue}</span>
      {balanceLabel}
    </div>
  </div>
);

import React, { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { ZapToken } from '../../hooks/useZap';
import { formatAmount } from '../../format';
import { TokenIcon } from '../TokenIcon';
import { ChevronDown } from '../ui/icons';

interface TokenPickerProps {
  chainId: number;
  tokens: ZapToken[];
  selected: ZapToken;
  onSelect: (token: ZapToken) => void;
  disabled?: boolean;
  ariaLabel: string;
}

/** The token button of the amount field; opens a list when there is a choice. */
export const TokenPicker: React.FC<TokenPickerProps> = ({
  chainId,
  tokens,
  selected,
  onSelect,
  disabled,
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasChoice = tokens.length > 1;

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  return (
    <div className="y-token-picker" ref={ref}>
      <button
        type="button"
        className="y-token-select"
        aria-label={ariaLabel}
        aria-haspopup={hasChoice ? 'listbox' : undefined}
        aria-expanded={hasChoice ? isOpen : undefined}
        disabled={disabled || !hasChoice}
        onClick={() => setIsOpen((open) => !open)}
      >
        <TokenIcon
          src={selected.logo}
          symbol={selected.symbol}
          chainId={chainId}
          tokenAddress={selected.address}
          size={28}
        />
        <span className="y-token-select__symbol">{selected.symbol}</span>
        {hasChoice && <ChevronDown size={16} />}
      </button>
      {isOpen && (
        <ul className="y-token-menu" role="listbox">
          {tokens.map((token) => {
            const isActive = token.address.toLowerCase() === selected.address.toLowerCase();
            return (
              <li key={token.address}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`y-token-menu__item${isActive ? ' is-active' : ''}`}
                  onClick={() => {
                    onSelect(token);
                    setIsOpen(false);
                  }}
                >
                  <TokenIcon
                    src={token.logo}
                    symbol={token.symbol}
                    chainId={chainId}
                    tokenAddress={token.address}
                    size={24}
                  />
                  <span className="y-token-menu__symbol">{token.symbol}</span>
                  {token.balance !== undefined && (
                    <span className="y-token-menu__balance">
                      {formatAmount(Number(formatUnits(token.balance, token.decimals)))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

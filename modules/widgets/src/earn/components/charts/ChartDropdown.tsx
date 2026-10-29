import { useState } from 'react';
import { ChevronDown } from '../ui/icons';
import { useT } from '../../i18n';

export interface ChartDropdownOption<T extends string> {
  id: T;
  label: string;
}

interface ChartDropdownProps<T extends string> {
  value: T;
  options: ChartDropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** The small select next to chart tabs — timeframe, value type. */
export function ChartDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: ChartDropdownProps<T>) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const current = options.find((option) => option.id === value)?.label;

  return (
    <div className="y-vd-chart__period">
      <button
        type="button"
        className="y-vd-chart__period-btn"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {current !== undefined ? t(current) : current}
        <ChevronDown size={16} />
      </button>
      {isOpen && (
        <>
          <div className="y-vd-chart__period-backdrop" onClick={() => setIsOpen(false)} />
          <ul className="y-vd-chart__period-menu" role="listbox">
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === option.id}
                  className={`y-vd-chart__period-item${value === option.id ? ' is-active' : ''}`}
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                  }}
                >
                  {t(option.label)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

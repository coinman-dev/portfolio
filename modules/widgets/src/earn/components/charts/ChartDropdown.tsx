import { useState } from 'react';
import { ChevronDown } from '../ui/icons';

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
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="y-vd-chart__period">
      <button
        type="button"
        className="y-vd-chart__period-btn"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {options.find((option) => option.id === value)?.label}
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
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

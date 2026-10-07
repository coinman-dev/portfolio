import React from 'react';

interface VaultsListChipProps {
  label: string;
  className?: string;
  icon?: React.ReactNode;
  isActive?: boolean;
  ariaLabel?: string;
  title?: string;
  onClick?: () => void;
}

/** `inline-flex rounded-lg border px-1 py-0.5 text-xs font-medium` — yearn.fi row chip. */
export const VaultsListChip: React.FC<VaultsListChipProps> = ({
  label,
  className: extraClassName,
  icon,
  isActive = false,
  ariaLabel,
  title,
  onClick,
}) => {
  const className = `y-chip${onClick ? ' y-chip--btn' : ''}${isActive ? ' is-active' : ''}${
    extraClassName ? ` ${extraClassName}` : ''
  }`;

  if (!onClick) {
    return (
      <span className={className} title={title}>
        {icon}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-active={isActive ? 'true' : 'false'}
      aria-pressed={isActive}
      aria-label={ariaLabel || label}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};

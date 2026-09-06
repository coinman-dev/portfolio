import React from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: 'false' as const,
});

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const ChevronDown: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M6 9L12 15L18 9" {...stroke} />
  </svg>
);

export const ChevronUp: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M18 15L12 9L6 15" {...stroke} />
  </svg>
);

export const ChevronLeft: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M15 18L9 12L15 6" {...stroke} />
  </svg>
);

export const ArrowUp: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M12 19V5M5 12L12 5L19 12" {...stroke} />
  </svg>
);

export const Lock: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="4" y="10" width="16" height="11" rx="2" {...stroke} />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" {...stroke} />
  </svg>
);

export const Unlock: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="4" y="10" width="16" height="11" rx="2" {...stroke} />
    <path d="M8 10V7a4 4 0 0 1 7.5-2" {...stroke} />
  </svg>
);

export const ExternalLink: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M14 4h6v6M20 4l-9 9" {...stroke} />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" {...stroke} />
  </svg>
);

export const Copy: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <rect x="9" y="9" width="11" height="11" rx="2" {...stroke} />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" {...stroke} />
  </svg>
);

export const Check: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4 12.5L9 17.5L20 6.5" {...stroke} />
  </svg>
);

export const Search: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="11" cy="11" r="7" {...stroke} />
    <path d="M20 20L16.2 16.2" {...stroke} />
  </svg>
);

export const Sliders: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" {...stroke} />
    <circle cx="16" cy="6" r="2" {...stroke} />
    <circle cx="10" cy="12" r="2" {...stroke} />
    <circle cx="16" cy="18" r="2" {...stroke} />
  </svg>
);

export const Compare: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="6" cy="6" r="3" {...stroke} />
    <circle cx="18" cy="18" r="3" {...stroke} />
    <path d="M13 6h4a2 2 0 0 1 2 2v7" {...stroke} />
    <path d="M11 18H7a2 2 0 0 1-2-2V9" {...stroke} />
  </svg>
);

export const Wallet: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 0 0-2H5a4 4 0 0 0-4 4" {...stroke} />
    <rect x="2" y="6" width="20" height="15" rx="2" {...stroke} />
    <circle cx="17" cy="13.5" r="1.5" {...stroke} />
  </svg>
);

export const Sun: React.FC<IconProps> = ({ size = 20, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="12" cy="12" r="5" {...stroke} />
    <path
      d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
      {...stroke}
    />
  </svg>
);

export const Moon: React.FC<IconProps> = ({ size = 20, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" {...stroke} />
  </svg>
);

export const Close: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M6 6L18 18M18 6L6 18" {...stroke} />
  </svg>
);

export const Info: React.FC<IconProps> = ({ size = 16, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <circle cx="12" cy="12" r="9" {...stroke} />
    <path d="M12 11v5M12 8h.01" {...stroke} />
  </svg>
);

export const Menu: React.FC<IconProps> = ({ size = 24, className, style }) => (
  <svg {...base(size)} className={className} style={style}>
    <path d="M3 6h18M3 12h18M3 18h18" {...stroke} />
  </svg>
);

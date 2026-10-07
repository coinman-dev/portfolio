import React, { useEffect, useRef, useState } from 'react';
import { Close } from '../ui/icons';

interface InfoPopoverProps {
  label: string;
  title: string;
  children: React.ReactNode;
}

/** Dotted-underline label that opens yearn.fi's explanation card. */
export const InfoPopover: React.FC<InfoPopoverProps> = ({ label, title, children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <div className="y-info-pop" ref={anchorRef}>
      <button
        type="button"
        className="y-info-pop__trigger"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {label}
      </button>
      {isOpen && (
        <>
          <div className="y-info-pop__backdrop" onClick={() => setIsOpen(false)} />
          <div className="y-info-pop__card" role="dialog" aria-label={title}>
            <div className="y-info-pop__head">
              <h4 className="y-info-pop__title">{title}</h4>
              <button
                type="button"
                className="y-info-pop__close"
                aria-label="Close"
                onClick={() => setIsOpen(false)}
              >
                <Close size={14} />
              </button>
            </div>
            <div className="y-info-pop__body">{children}</div>
            <button type="button" className="y-btn y-btn--light" onClick={() => setIsOpen(false)}>
              Got it
            </button>
          </div>
        </>
      )}
    </div>
  );
};

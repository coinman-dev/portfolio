import React, { useState } from 'react';
import { ChevronDown } from '../ui/icons';

interface SectionCardProps {
  id: string;
  title: string;
  children: React.ReactNode;
  /** Sections open by default on yearn.fi; the chevron toggles them. */
  defaultOpen?: boolean;
  bodyClassName?: string;
  sectionRef?: React.Ref<HTMLElement>;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  id,
  title,
  children,
  defaultOpen = true,
  bodyClassName,
  sectionRef,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="y-vd-card" id={id} ref={sectionRef}>
      <button
        type="button"
        className="y-vd-card__head"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <h2 className="y-vd-card__title">{title}</h2>
        <ChevronDown
          size={16}
          className={`y-vd-card__chevron${isOpen ? ' is-open' : ''}`}
        />
      </button>
      {isOpen && <div className={`y-vd-card__body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>}
    </section>
  );
};

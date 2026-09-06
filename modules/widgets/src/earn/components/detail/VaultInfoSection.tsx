import React from 'react';
import { YearnVault } from '../../types';
import { VaultAboutSection } from '../shared/VaultAboutSection';
import { SectionCard } from './SectionCard';

interface VaultInfoSectionProps {
  vault: YearnVault;
  sectionRef?: React.Ref<HTMLElement>;
}

export const VaultInfoSection: React.FC<VaultInfoSectionProps> = ({ vault, sectionRef }) => (
  <SectionCard id="info" title="Vault Info" sectionRef={sectionRef}>
    <VaultAboutSection vault={vault} />
  </SectionCard>
);

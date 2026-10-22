import React from 'react';
import { YearnVault } from '../../types';
import { VaultAboutSection } from '../shared/VaultAboutSection';
import { SectionCard } from './SectionCard';
import { useT } from '../../i18n';

interface VaultInfoSectionProps {
  vault: YearnVault;
  sectionRef?: React.Ref<HTMLElement>;
}

export const VaultInfoSection: React.FC<VaultInfoSectionProps> = ({ vault, sectionRef }) => {
  const t = useT();
  return (
    <SectionCard id="info" title={t('Vault Info')} sectionRef={sectionRef}>
      <VaultAboutSection vault={vault} />
    </SectionCard>
  );
};

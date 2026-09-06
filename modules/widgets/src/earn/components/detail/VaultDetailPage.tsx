import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { YearnVault } from '../../types';
import { formatUSD } from '../../format';
import { getUserVaultShares } from '../../yearnContracts';
import { ArrowUp } from '../ui/icons';
import { VaultWidget, WidgetTab } from '../widget/VaultWidget';
import { DetailSection, VaultDetailHeader, VaultIdentity } from './VaultDetailHeader';
import { VaultChartsSection } from './VaultChartsSection';
import { VaultInfoSection } from './VaultInfoSection';
import { VaultStrategiesSection } from './VaultStrategiesSection';
import { VaultRiskSection } from './VaultRiskSection';
import { VaultMoreInfoSection } from './VaultMoreInfoSection';

const WIDGET_TABS: { id: WidgetTab; label: string }[] = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'info', label: 'My Info' },
];

interface VaultDetailPageProps {
  vault: YearnVault;
  walletAddress?: string;
  walletChainId?: number;
  onConnectWallet: () => void;
}

export const VaultDetailPage: React.FC<VaultDetailPageProps> = ({
  vault,
  walletAddress,
  walletChainId,
  onConnectWallet,
}) => {
  const [activeSection, setActiveSection] = useState<DetailSection>('performance');
  const [widgetTab, setWidgetTab] = useState<WidgetTab>('deposit');
  const [isCompact, setIsCompact] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [deposits, setDeposits] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useMemo(
    () => ({
      performance: React.createRef<HTMLElement>(),
      info: React.createRef<HTMLElement>(),
      strategies: React.createRef<HTMLElement>(),
      risk: React.createRef<HTMLElement>(),
      more: React.createRef<HTMLElement>(),
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    if (!walletAddress) {
      setDeposits(0);
      return () => {
        cancelled = true;
      };
    }
    getUserVaultShares(vault.chainID, vault.address, walletAddress)
      .then((shares) => {
        if (cancelled) return;
        const underlying = Number(
          formatUnits(shares.assetsUnderlying, vault.token.decimals || 18)
        );
        setDeposits(underlying * (vault.tvl?.price || 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [vault.chainID, vault.address, vault.token.decimals, vault.tvl?.price, walletAddress]);

  // The header collapses its chips once the page scrolls past the sentinel.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsCompact(!entry.isIntersecting),
      { threshold: 1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Scroll-spy: the tab bar follows the section currently in view.
  useEffect(() => {
    const entries = Object.entries(sectionRefs) as [DetailSection, React.RefObject<HTMLElement>][];
    const nodes = entries
      .map(([id, ref]) => (ref.current ? { id, node: ref.current } : null))
      .filter(Boolean) as { id: DetailSection; node: HTMLElement }[];
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (observed) => {
        const visible = observed
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        const match = nodes.find((item) => item.node === visible.target);
        if (match) setActiveSection(match.id);
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    nodes.forEach((item) => observer.observe(item.node));
    return () => observer.disconnect();
  }, [sectionRefs, vault.address]);

  useEffect(() => {
    const scroller = rootRef.current?.closest('#earn-view') as HTMLElement | null;
    const target: HTMLElement | Window = scroller || window;
    const onScroll = () => {
      const top = scroller ? scroller.scrollTop : window.scrollY;
      setShowScrollTop(top > 400);
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener('scroll', onScroll);
  }, []);

  const goToSection = (section: DetailSection) => {
    setActiveSection(section);
    sectionRefs[section].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToTop = () => {
    const scroller = rootRef.current?.closest('#earn-view') as HTMLElement | null;
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="y-vd" ref={rootRef}>
      <div ref={sentinelRef} className="y-vd__sentinel" />

      {/* Stays in flow and simply scrolls away — unmounting it here would shift
          the page under the sentinel and make the compact state oscillate.
          The sticky card renders its own compact copy. */}
      <VaultIdentity vault={vault} isCompact={false} />

      <div className="y-vd__sticky">
        <VaultDetailHeader
          vault={vault}
          activeSection={activeSection}
          onSelectSection={goToSection}
          isCompact={isCompact}
        />

        <div className="y-vd-side">
          <div className="y-vd-deposits">
            <span className="y-vd-deposits__label">Your Deposits</span>
            <span className="y-vd-deposits__value">{formatUSD(deposits)}</span>
          </div>
          <div className="y-vd-tabs y-vd-tabs--widget" role="tablist" aria-label="Vault actions">
            {WIDGET_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={widgetTab === tab.id}
                className={`y-vd-tab${widgetTab === tab.id ? ' is-active' : ''}`}
                onClick={() => setWidgetTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="y-vd__body">
        <div className="y-vd__main">
          <VaultChartsSection vault={vault} sectionRef={sectionRefs.performance} />
          <VaultInfoSection vault={vault} sectionRef={sectionRefs.info} />
          <VaultStrategiesSection vault={vault} sectionRef={sectionRefs.strategies} />
          <VaultRiskSection vault={vault} sectionRef={sectionRefs.risk} />
          <VaultMoreInfoSection vault={vault} sectionRef={sectionRefs.more} />
        </div>

        <aside className="y-vd__aside">
          <VaultWidget
            vault={vault}
            tab={widgetTab}
            walletAddress={walletAddress}
            walletChainId={walletChainId}
            onConnectWallet={onConnectWallet}
          />
        </aside>
      </div>

      {showScrollTop && (
        <button
          type="button"
          className="y-scroll-top"
          aria-label="Scroll to top"
          onClick={scrollToTop}
        >
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
};

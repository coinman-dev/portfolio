import React from 'react';
import { TokenIcon } from '../TokenIcon';
import { getChain } from '../../yearnApi';

interface VaultAvatarProps {
  icon?: string;
  tokenIcon?: string;
  symbol: string;
  chainId: number;
  tokenAddress?: string;
  size?: number;
  /** Chain badge in the bottom-left corner, as on yearn.fi rows. */
  showChainBadge?: boolean;
}

export const VaultAvatar: React.FC<VaultAvatarProps> = ({
  icon,
  tokenIcon,
  symbol,
  chainId,
  tokenAddress,
  size = 40,
  showChainBadge = true,
}) => {
  const chain = getChain(chainId);
  return (
    <div className="y-avatar" style={{ width: size, height: size }}>
      <TokenIcon
        src={icon}
        tokenIcon={tokenIcon}
        symbol={symbol}
        chainId={chainId}
        tokenAddress={tokenAddress}
        size={size}
      />
      {showChainBadge && (
        <span className="y-avatar__badge" title={chain.name}>
          <img src={chain.icon} alt={chain.name} loading="lazy" />
        </span>
      )}
    </div>
  );
};

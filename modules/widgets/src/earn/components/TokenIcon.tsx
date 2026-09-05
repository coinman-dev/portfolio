import React, { useState } from 'react';

interface TokenIconProps {
  src?: string;
  tokenIcon?: string;
  symbol: string;
  chainId?: number;
  tokenAddress?: string;
  size?: number;
  className?: string;
}

export const TokenIcon: React.FC<TokenIconProps> = ({
  src,
  tokenIcon,
  symbol,
  chainId,
  tokenAddress,
  size = 32,
  className = '',
}) => {
  const [candidateIndex, setCandidateIndex] = useState<number>(0);
  const [fallbackTriggered, setFallbackTriggered] = useState<boolean>(false);

  // Build candidate URL list
  const candidates: string[] = [];
  if (src && src.trim()) candidates.push(src.trim());
  if (tokenIcon && tokenIcon.trim() && !candidates.includes(tokenIcon.trim())) {
    candidates.push(tokenIcon.trim());
  }
  if (chainId && tokenAddress && tokenAddress.trim()) {
    const smoldAppUrl = `https://assets.smold.app/api/token/${chainId}/${tokenAddress.trim()}/logo-128.png`;
    if (!candidates.includes(smoldAppUrl)) {
      candidates.push(smoldAppUrl);
    }
  }

  const currentSrc = !fallbackTriggered && candidateIndex < candidates.length ? candidates[candidateIndex] : null;

  const handleImgError = () => {
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex((prev) => prev + 1);
    } else {
      setFallbackTriggered(true);
    }
  };

  if (!currentSrc || fallbackTriggered) {
    const displayLetters = (symbol || 'Y').slice(0, 3).toUpperCase();
    return (
      <div
        className={`token-fallback-avatar ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          borderRadius: '50%',
          backgroundColor: '#1a2233',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: '#ffffff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: size <= 24 ? 9 : size <= 32 ? 11 : 14,
          letterSpacing: '-0.5px',
          userSelect: 'none',
          boxSizing: 'border-box',
        }}
      >
        {displayLetters}
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={symbol || 'token'}
      className={className}
      onError={handleImgError}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        objectFit: 'cover',
        display: 'block',
        backgroundColor: '#121622',
      }}
      loading="lazy"
    />
  );
};

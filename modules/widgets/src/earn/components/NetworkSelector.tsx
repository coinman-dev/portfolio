import React from 'react';
import { SUPPORTED_CHAINS } from '../yearnApi';

interface NetworkSelectorProps {
  selectedChainId: number | 'all';
  onSelectChain: (chainId: number | 'all') => void;
}

export const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  selectedChainId,
  onSelectChain,
}) => {
  return (
    <div className="yearn-network-pills">
      <button
        type="button"
        className={`yearn-network-pill ${selectedChainId === 'all' ? 'active' : ''}`}
        onClick={() => onSelectChain('all')}
      >
        <span>All Networks</span>
      </button>

      {SUPPORTED_CHAINS.map((chain) => (
        <button
          key={chain.id}
          type="button"
          className={`yearn-network-pill ${selectedChainId === chain.id ? 'active' : ''}`}
          onClick={() => onSelectChain(chain.id)}
        >
          <img
            src={chain.icon}
            alt={chain.name}
            className="yearn-network-pill-icon"
            onError={(e) => {
              (e.target as any).style.display = 'none';
            }}
          />
          <span>{chain.name}</span>
        </button>
      ))}
    </div>
  );
};

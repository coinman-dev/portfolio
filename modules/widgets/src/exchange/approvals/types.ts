/** Wallet families Approvals covers. */
export type Family = 'EVM' | 'TVM' | 'SVM';

/**
 * - token: ERC-20 / TRC-20 allowance
 * - nft-token: one NFT approved to someone (ERC-721 `approve`)
 * - nft-all: a whole collection (`setApprovalForAll`, ERC-721 and ERC-1155)
 * - permit2: an allowance inside Uniswap's Permit2 contract
 * - delegate: a Solana token account's delegate
 */
export type ApprovalKind = 'token' | 'nft-token' | 'nft-all' | 'permit2' | 'delegate';

export type RiskLevel = 'high' | 'medium' | 'low';

export interface RiskReason {
  level: RiskLevel;
  text: string;
}

/** What is known about whoever may spend. */
export interface SpenderInfo {
  /** contract / program, plain account (someone's key), or not known. */
  type: 'contract' | 'account' | 'unknown';
  name?: string;
  /** In CoinMan's own list of protocols (not just a verified name). */
  known?: boolean;
  /** Source code published (Blockscout / Sourcify); null = could not tell. */
  verified?: boolean | null;
  /** Flagged as a scam by the explorer. */
  scam?: boolean;
}

export interface Approval {
  /** Stable across scans: family, chain, kind, token, spender, NFT id. */
  id: string;
  family: Family;
  /** LI.FI chain id (EVM chain id, Tron 728126428, Solana 1151111081099710). */
  chainId: number;
  chainName: string;
  kind: ApprovalKind;
  /** Token or collection contract; Solana: the mint. */
  token: string;
  /** Solana: the token account the delegate is set on. */
  tokenAccount?: string;
  /** Solana: Token or Token-2022 program of that account. */
  tokenProgram?: string;
  symbol: string;
  tokenName?: string;
  decimals?: number;
  logo?: string;
  /** Token listed by LI.FI (a real, priced token rather than an unknown one). */
  listed: boolean;
  spender: string;
  spenderInfo: SpenderInfo;
  /** Allowed amount; undefined for whole-collection NFT approvals. */
  amount?: bigint;
  unlimited: boolean;
  /** Permit2: unix seconds after which the allowance lapses. */
  expiration?: number;
  tokenId?: bigint;
  /** What the wallet holds of this token (NFTs: how many). */
  balance?: bigint;
  priceUSD?: number;
  /** Value the spender could take today; undefined when it cannot be priced. */
  atRiskUSD?: number;
  /** When the approval was last set (unix seconds), if known. */
  lastChange?: number;
  lastBlock?: number;
  lastTx?: string;
  risk: RiskLevel;
  reasons: RiskReason[];
}

/** One network's scan as the list shows it. */
export interface ChainScan {
  key: string;
  family: Family;
  chainId: number;
  name: string;
  status: 'waiting' | 'scanning' | 'done' | 'error' | 'skipped';
  /** Where the list came from (HyperSync, Blockscout, the network's RPC…). */
  source?: string;
  error?: string;
  /** A partial result: more history exists than was read. */
  note?: string;
  approvals: Approval[];
}

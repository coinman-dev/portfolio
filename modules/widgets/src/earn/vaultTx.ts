/**
 * Deposit and withdraw routes, as yearn.fi's vault widget picks them
 * (`packages/vault-widget`: useDepositRoute, useWithdrawRoute, stakingAdapter).
 *
 * The flow is read → plan → run:
 * - `readVaultPosition` takes one multicall snapshot of everything a route
 *   depends on (balances, price per share, limits, allowances, staking).
 * - `planDeposit` / `planWithdraw` turn an amount into ordered contract calls.
 *   Plans are plain data, so the same code path can be simulated against real
 *   holders without sending anything.
 * - `runPlan` simulates each call before the wallet is asked to sign it, so a
 *   call that would revert is never sent.
 *
 * Contract facts (verified with eth_call on mainnet):
 * - V2 vaults (0.x) are not ERC-4626: withdraw is `withdraw(maxShares, recipient)`
 *   (default maxLoss 1 bp), there is no `redeem`/`convertToAssets`/`maxRedeem`.
 * - V3 vaults and tokenized strategies: `withdraw(assets, receiver, owner)`
 *   allows no loss; `redeem(shares, receiver, owner)` defaults to 100% loss, so
 *   the four-argument overload with an explicit `maxLoss` is used instead.
 * - Staking: VeYFI gauges are ERC-4626 over vault shares (1:1); OP Boost,
 *   Juiced and V3 Staking are StakingRewards (`withdraw(uint256)`, 1:1);
 *   st-yBOLD is a tokenized strategy over yBOLD with no cooldown.
 */

import { parseAbi } from 'viem';
import {
  readContracts,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from '@wagmi/core';
import { wagmiConfig } from '../wallet/wallet';
import { YearnVault } from './types';
import {
  MAX_LOSS_BPS,
  YBOLD_VAULT_ADDRESS,
  YBOLD_ZAPPER_ADDRESS,
  YVUSD_ZAP_ADDRESS,
} from './constants';

type Address = `0x${string}`;

export const ERC20_TX_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  // No return value declared: USDT's approve returns nothing.
  'function approve(address spender, uint256 amount)',
]);

export const V3_VAULT_ABI = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner, uint256 maxLoss) returns (uint256)',
  'function maxDeposit(address receiver) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function previewWithdraw(uint256 assets) view returns (uint256)',
  'function pricePerShare() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const V2_VAULT_ABI = parseAbi([
  'function deposit(uint256 amount, address recipient) returns (uint256)',
  'function withdraw(uint256 maxShares, address recipient) returns (uint256)',
  'function availableDepositLimit() view returns (uint256)',
  'function pricePerShare() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const GAUGE_ABI = parseAbi([
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const STAKING_REWARDS_ABI = parseAbi([
  'function withdraw(uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const YBOLD_ZAPPER_ABI = parseAbi([
  'function zapIn(uint256 assets, address receiver) returns (uint256)',
  'function zapOut(uint256 shares, address receiver, uint256 maxLoss) returns (uint256)',
]);

export const LOCKED_ZAP_ABI = parseAbi([
  'function zapIn(uint256 _amount, address _receiver) returns (uint256)',
  'function zapOut(uint256 _shares, address _receiver) returns (uint256)',
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const WAD = 10n ** 18n;

export const isV3Vault = (vault: YearnVault) => /^~?3/.test(String(vault.version || ''));

export const isRetiredVault = (vault: YearnVault) =>
  Boolean(vault.details?.isRetired || vault.info?.isRetired);

/** Deposits are closed: retired (yearn.fi drops the Deposit tab) or shut down. */
export const isDepositClosed = (vault: YearnVault) =>
  isRetiredVault(vault) || Boolean(vault.emergency_shutdown);

export type StakingKind = 'ybold' | 'gauge' | 'rewards';

export interface StakingInfo {
  kind: StakingKind;
  address: Address;
}

/** yearn.fi uses `staking.address` for withdrawals whether or not it is `available`. */
export function getStaking(vault: YearnVault): StakingInfo | null {
  const address = vault.staking?.address;
  if (!address || address.toLowerCase() === ZERO_ADDRESS) return null;
  if (address.toLowerCase() === vault.address.toLowerCase()) return null;
  const source = vault.staking?.source || '';
  const kind: StakingKind = source === 'yBOLD' ? 'ybold' : source === 'VeYFI' ? 'gauge' : 'rewards';
  return { kind, address: address as Address };
}

const isYBold = (vault: YearnVault) =>
  vault.chainID === 1 && vault.address.toLowerCase() === YBOLD_VAULT_ADDRESS.toLowerCase();

/** Only yBOLD stakes on deposit: every other staking contract pays 0% today,
 *  and yearn.fi needs its Enso zap to deposit and stake in one go. */
export const canStakeOnDeposit = (vault: YearnVault) => isYBold(vault) && getStaking(vault) !== null;

export const shareDecimals = (vault: YearnVault) => vault.decimals ?? vault.token.decimals ?? 18;

export interface VaultPosition {
  /** Deposit asset in the wallet. */
  assetBalance: bigint;
  /** Deposit asset allowance per spender (lowercase address). */
  assetAllowance: Record<string, bigint>;
  vaultShares: bigint;
  /** Assets per 10^decimals vault shares. */
  pricePerShare: bigint;
  /** `maxDeposit(user)` (V3) or `availableDepositLimit()` (V2); null if unknown. */
  depositLimit: bigint | null;
  /** V3 only. */
  vaultMaxRedeem: bigint | null;
  stakingShares: bigint;
  stakingMaxRedeem: bigint | null;
  /** st-yBOLD: yBOLD per 1e18 st-yBOLD. */
  stakingPricePerShare: bigint | null;
  /** Staking shares approved to the yBOLD Zapper. */
  stakingZapAllowance: bigint;
}

/** Spenders the deposit asset may need to be approved to for this vault. */
export function depositSpenders(vault: YearnVault): Address[] {
  const spenders: Address[] = [vault.address as Address];
  if (canStakeOnDeposit(vault)) spenders.push(YBOLD_ZAPPER_ADDRESS as Address);
  if (vault.lockedTwin) spenders.push(YVUSD_ZAP_ADDRESS as Address);
  return spenders;
}

export async function readVaultPosition(vault: YearnVault, user: string): Promise<VaultPosition> {
  const chainId = vault.chainID;
  const owner = user as Address;
  const vaultAddress = vault.address as Address;
  const asset = vault.token.address as Address;
  const v3 = isV3Vault(vault);
  const staking = getStaking(vault);
  const spenders = depositSpenders(vault);

  const calls: any[] = [
    { chainId, address: asset, abi: ERC20_TX_ABI, functionName: 'balanceOf', args: [owner] },
    { chainId, address: vaultAddress, abi: V3_VAULT_ABI, functionName: 'balanceOf', args: [owner] },
    { chainId, address: vaultAddress, abi: V3_VAULT_ABI, functionName: 'pricePerShare' },
    v3
      ? { chainId, address: vaultAddress, abi: V3_VAULT_ABI, functionName: 'maxDeposit', args: [owner] }
      : { chainId, address: vaultAddress, abi: V2_VAULT_ABI, functionName: 'availableDepositLimit' },
    ...(v3
      ? [{ chainId, address: vaultAddress, abi: V3_VAULT_ABI, functionName: 'maxRedeem', args: [owner] }]
      : []),
    ...spenders.map((spender) => ({
      chainId,
      address: asset,
      abi: ERC20_TX_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    })),
  ];
  const stakingStart = calls.length;
  if (staking) {
    calls.push({ chainId, address: staking.address, abi: GAUGE_ABI, functionName: 'balanceOf', args: [owner] });
    if (staking.kind !== 'rewards') {
      calls.push({ chainId, address: staking.address, abi: GAUGE_ABI, functionName: 'maxRedeem', args: [owner] });
    }
    if (staking.kind === 'ybold') {
      calls.push(
        { chainId, address: staking.address, abi: V3_VAULT_ABI, functionName: 'pricePerShare' },
        {
          chainId,
          address: staking.address,
          abi: ERC20_TX_ABI,
          functionName: 'allowance',
          args: [owner, YBOLD_ZAPPER_ADDRESS],
        }
      );
    }
  }

  const results = await readContracts(wagmiConfig, { allowFailure: true, contracts: calls });
  const value = (index: number): bigint | null =>
    results[index]?.status === 'success' ? (results[index].result as bigint) : null;

  let cursor = v3 ? 5 : 4;
  const assetAllowance: Record<string, bigint> = {};
  for (const spender of spenders) {
    assetAllowance[spender.toLowerCase()] = value(cursor++) ?? 0n;
  }

  const decimals = shareDecimals(vault);
  // A vault that will not report its price per share falls back to the API's.
  const apiPricePerShare = vault.pricePerShare ? BigInt(vault.pricePerShare) : 10n ** BigInt(decimals);

  const position: VaultPosition = {
    assetBalance: value(0) ?? 0n,
    assetAllowance,
    vaultShares: value(1) ?? 0n,
    pricePerShare: value(2) ?? apiPricePerShare,
    depositLimit: value(3),
    vaultMaxRedeem: v3 ? value(4) : null,
    stakingShares: 0n,
    stakingMaxRedeem: null,
    stakingPricePerShare: null,
    stakingZapAllowance: 0n,
  };

  if (staking) {
    let index = stakingStart;
    position.stakingShares = value(index++) ?? 0n;
    if (staking.kind !== 'rewards') position.stakingMaxRedeem = value(index++);
    if (staking.kind === 'ybold') {
      position.stakingPricePerShare = value(index++);
      position.stakingZapAllowance = value(index++) ?? 0n;
    }
  }
  return position;
}

export const sharesToAssets = (shares: bigint, pricePerShare: bigint, decimals: number) =>
  (shares * pricePerShare) / 10n ** BigInt(decimals);

/** Rounds up, so the shares always cover the requested assets. */
export function assetsToShares(assets: bigint, pricePerShare: bigint, decimals: number): bigint {
  if (pricePerShare === 0n) return 0n;
  const scaled = assets * 10n ** BigInt(decimals);
  return (scaled + pricePerShare - 1n) / pricePerShare;
}

/**
 * Vault shares a full withdrawal may burn. V3 allocators report
 * `maxRedeem = balance - 1` yet redeem the full balance fine, so the cap only
 * applies when liquidity really is short (e.g. strategies with locked funds).
 */
export function maxVaultShares(position: VaultPosition): bigint {
  const { vaultShares, vaultMaxRedeem } = position;
  if (vaultMaxRedeem !== null && vaultMaxRedeem < vaultShares - 1n) return vaultMaxRedeem;
  return vaultShares;
}

/** Staking shares a full unstake may burn. */
export function maxStakingShares(position: VaultPosition): bigint {
  const { stakingShares, stakingMaxRedeem } = position;
  if (stakingMaxRedeem !== null && stakingMaxRedeem < stakingShares) return stakingMaxRedeem;
  return stakingShares;
}

/** Vault shares the staking position is worth (st-yBOLD → yBOLD; others 1:1). */
export function stakingVaultShares(vault: YearnVault, position: VaultPosition, stakingShares: bigint) {
  const staking = getStaking(vault);
  if (staking?.kind === 'ybold') {
    return position.stakingPricePerShare === null
      ? stakingShares
      : (stakingShares * position.stakingPricePerShare) / WAD;
  }
  return stakingShares;
}

export type WithdrawSource = 'vault' | 'staking';

/** Deposit asset the chosen source would pay out in full. */
export function withdrawableAssets(
  vault: YearnVault,
  position: VaultPosition,
  source: WithdrawSource
): bigint {
  const decimals = shareDecimals(vault);
  const shares =
    source === 'vault'
      ? maxVaultShares(position)
      : stakingVaultShares(vault, position, maxStakingShares(position));
  return sharesToAssets(shares, position.pricePerShare, decimals);
}

/** Sources holding anything, in yearn.fi's order. */
export function fundedSources(vault: YearnVault, position: VaultPosition | null): WithdrawSource[] {
  if (!position) return [];
  const sources: WithdrawSource[] = [];
  if (position.vaultShares > 0n) sources.push('vault');
  if (getStaking(vault) && position.stakingShares > 0n) sources.push('staking');
  return sources;
}

export interface ContractCall {
  chainId: number;
  address: Address;
  abi: any;
  functionName: string;
  args: readonly unknown[];
}

export interface TxStep {
  label: string;
  /** A function is resolved right before the step runs — for amounts only
   *  known once the previous step has landed. Returning null skips it. */
  call: ContractCall | (() => Promise<ContractCall | null>);
}

/**
 * Exact-amount approval, as yearn.fi does. Tokens like USDT refuse to change a
 * non-zero allowance, so an existing one that is too small is reset first.
 */
export function approvalSteps(
  chainId: number,
  token: string,
  spender: string,
  amount: bigint,
  allowance: bigint,
  symbol: string
): TxStep[] {
  if (amount === 0n || allowance >= amount) return [];
  const approve = (value: bigint): ContractCall => ({
    chainId,
    address: token as Address,
    abi: ERC20_TX_ABI,
    functionName: 'approve',
    args: [spender as Address, value],
  });
  const steps: TxStep[] = [];
  if (allowance > 0n) steps.push({ label: `Reset ${symbol} approval`, call: approve(0n) });
  steps.push({ label: `Approve ${symbol}`, call: approve(amount) });
  return steps;
}

export interface DepositOptions {
  /** yBOLD only: stake the new shares in st-yBOLD through the Zapper. */
  stake: boolean;
}

export function planDeposit(
  vault: YearnVault,
  position: VaultPosition,
  amount: bigint,
  user: string,
  options: DepositOptions
): TxStep[] {
  const chainId = vault.chainID;
  const receiver = user as Address;
  const symbol = vault.token.symbol;

  if (options.stake && canStakeOnDeposit(vault)) {
    const zapper = YBOLD_ZAPPER_ADDRESS.toLowerCase();
    return [
      ...approvalSteps(chainId, vault.token.address, zapper, amount, position.assetAllowance[zapper] ?? 0n, symbol),
      {
        label: 'Deposit and stake',
        call: {
          chainId,
          address: YBOLD_ZAPPER_ADDRESS as Address,
          abi: YBOLD_ZAPPER_ABI,
          functionName: 'zapIn',
          args: [amount, receiver],
        },
      },
    ];
  }

  const spender = vault.address.toLowerCase();
  return [
    ...approvalSteps(chainId, vault.token.address, spender, amount, position.assetAllowance[spender] ?? 0n, symbol),
    {
      label: 'Deposit',
      call: {
        chainId,
        address: vault.address as Address,
        // Same signature on V2 and V3.
        abi: isV3Vault(vault) ? V3_VAULT_ABI : V2_VAULT_ABI,
        functionName: 'deposit',
        args: [amount, receiver],
      },
    },
  ];
}

/** Burns vault shares for the deposit asset. */
function vaultWithdrawCall(
  vault: YearnVault,
  user: Address,
  shares: bigint,
  assets: bigint,
  isMax: boolean
): ContractCall {
  const base = { chainId: vault.chainID, address: vault.address as Address };
  if (!isV3Vault(vault)) {
    return { ...base, abi: V2_VAULT_ABI, functionName: 'withdraw', args: [shares, user] };
  }
  if (isMax) {
    return { ...base, abi: V3_VAULT_ABI, functionName: 'redeem', args: [shares, user, user, MAX_LOSS_BPS] };
  }
  return { ...base, abi: V3_VAULT_ABI, functionName: 'withdraw', args: [assets, user, user] };
}

async function readBigint(call: Omit<ContractCall, 'abi'> & { abi: any }): Promise<bigint> {
  const [result] = await readContracts(wagmiConfig, { allowFailure: false, contracts: [call as any] });
  return result as bigint;
}

export interface WithdrawPlan {
  steps: TxStep[];
  /** Shares of the chosen source that will be burned. */
  sharesIn: bigint;
  /** Deposit asset the user should end up with. */
  assetsOut: bigint;
}

/**
 * @param amount deposit-asset amount the user typed (ignored when `isMax`).
 */
export async function planWithdraw(
  vault: YearnVault,
  position: VaultPosition,
  source: WithdrawSource,
  amount: bigint,
  isMax: boolean,
  user: string
): Promise<WithdrawPlan> {
  const chainId = vault.chainID;
  const owner = user as Address;
  const decimals = shareDecimals(vault);
  const pps = position.pricePerShare;

  if (source === 'vault') {
    const maxShares = maxVaultShares(position);
    const shares = isMax ? maxShares : minBig(assetsToShares(amount, pps, decimals), maxShares);
    const assetsOut = isMax ? sharesToAssets(shares, pps, decimals) : amount;
    return {
      steps: [{ label: 'Withdraw', call: vaultWithdrawCall(vault, owner, shares, assetsOut, isMax) }],
      sharesIn: shares,
      assetsOut,
    };
  }

  const staking = getStaking(vault);
  if (!staking) throw new Error('This vault has no staking contract.');
  const stakedMax = maxStakingShares(position);

  if (staking.kind === 'ybold') {
    // st-yBOLD shares for the typed BOLD: yBOLD shares first, then st-yBOLD
    // shares — both previews round up.
    let stShares = stakedMax;
    if (!isMax) {
      const yBoldShares = await readBigint({
        chainId,
        address: vault.address as Address,
        abi: V3_VAULT_ABI,
        functionName: 'previewWithdraw',
        args: [amount],
      });
      stShares = minBig(
        await readBigint({
          chainId,
          address: staking.address,
          abi: V3_VAULT_ABI,
          functionName: 'previewWithdraw',
          args: [yBoldShares],
        }),
        stakedMax
      );
    }
    const assetsOut = isMax
      ? sharesToAssets(stakingVaultShares(vault, position, stShares), pps, decimals)
      : amount;
    return {
      steps: [
        ...approvalSteps(
          chainId,
          staking.address,
          YBOLD_ZAPPER_ADDRESS,
          stShares,
          position.stakingZapAllowance,
          'st-yBOLD'
        ),
        {
          label: 'Withdraw',
          call: {
            chainId,
            address: YBOLD_ZAPPER_ADDRESS as Address,
            abi: YBOLD_ZAPPER_ABI,
            functionName: 'zapOut',
            args: [stShares, owner, MAX_LOSS_BPS],
          },
        },
      ],
      sharesIn: stShares,
      assetsOut,
    };
  }

  // Gauges and StakingRewards hold vault shares 1:1: unstake, then withdraw
  // from the vault — two transactions, as on yearn.fi.
  const unstakeShares = isMax ? stakedMax : minBig(assetsToShares(amount, pps, decimals), stakedMax);
  const unstake: ContractCall =
    staking.kind === 'gauge'
      ? isMax
        ? {
            chainId,
            address: staking.address,
            abi: GAUGE_ABI,
            functionName: 'redeem',
            args: [unstakeShares, owner, owner],
          }
        : {
            chainId,
            address: staking.address,
            abi: GAUGE_ABI,
            functionName: 'withdraw',
            args: [unstakeShares, owner, owner],
          }
      : {
          chainId,
          address: staking.address,
          abi: STAKING_REWARDS_ABI,
          functionName: 'withdraw',
          args: [unstakeShares],
        };

  const sharesBefore = position.vaultShares;
  const assetsOut = isMax ? sharesToAssets(unstakeShares, pps, decimals) : amount;
  return {
    steps: [
      { label: 'Unstake', call: unstake },
      {
        label: 'Withdraw',
        // Burn exactly what the unstake returned, leaving any shares the user
        // already held in the vault untouched.
        call: async () => {
          const sharesNow = await readBigint({
            chainId,
            address: vault.address as Address,
            abi: V3_VAULT_ABI,
            functionName: 'balanceOf',
            args: [owner],
          });
          const received = sharesNow - sharesBefore;
          if (received <= 0n) return null;
          return vaultWithdrawCall(vault, owner, received, amount, isMax);
        },
      },
    ],
    sharesIn: unstakeShares,
    assetsOut,
  };
}

const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

export interface PlanProgress {
  index: number;
  total: number;
  label: string;
}

/**
 * Runs the steps in order. Each call is simulated first — a revert surfaces
 * as an error before the wallet is asked to sign — then sent and awaited.
 * The caller makes sure the wallet is on the vault's chain first. Returns the
 * hash of the last transaction.
 */
export async function runPlan(
  steps: TxStep[],
  user: string,
  onProgress: (progress: PlanProgress) => void
): Promise<string | undefined> {
  let lastHash: string | undefined;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    onProgress({ index, total: steps.length, label: step.label });
    const call = typeof step.call === 'function' ? await step.call() : step.call;
    if (!call) continue;
    const { request } = await simulateContract(wagmiConfig, {
      ...(call as any),
      chainId: call.chainId as any,
      account: user as Address,
    });
    const hash = await writeContract(wagmiConfig, request as any);
    await waitForTransactionReceipt(wagmiConfig, { hash, chainId: call.chainId as any });
    lastHash = hash;
  }
  return lastHash;
}

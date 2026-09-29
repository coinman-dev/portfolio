import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { readContracts, switchChain } from '@wagmi/core';
import { YearnVault } from '../types';
import { wagmiConfig } from '../../wallet/wallet';
import { YVUSD_COOLDOWN_DAYS, YVUSD_WITHDRAW_WINDOW_DAYS, YVUSD_ZAP_ADDRESS } from '../constants';
import {
  cancelLockedCooldown,
  fetchLockedCooldown,
  fetchLockedSchedule,
  previewZapOut,
  startLockedCooldown,
} from '../yearnContracts';
import {
  ERC20_TX_ABI,
  LOCKED_ZAP_ABI,
  PlanProgress,
  TxStep,
  V3_VAULT_ABI,
  VaultPosition,
  WithdrawSource,
  approvalSteps,
  assetsToShares,
  canStakeOnDeposit,
  fundedSources,
  getStaking,
  isDepositClosed,
  maxStakingShares,
  maxVaultShares,
  planDeposit,
  planWithdraw,
  readVaultPosition,
  runPlan,
  shareDecimals,
  withdrawableAssets,
} from '../vaultTx';
import { YBOLD_ZAPPER_ADDRESS } from '../constants';

export type ActionStage = 'idle' | 'approving' | 'executing' | 'success' | 'error';

export interface ActionStatus {
  stage: ActionStage;
  message?: string;
  txHash?: string;
  /** The step of a multi-transaction plan that is running. */
  step?: PlanProgress;
}

export type WidgetMode = 'deposit' | 'withdraw';

/**
 * Which contract the widget works against. `unlocked`/`locked` are yvUSD's two
 * vaults; `staked` is the vault's staking contract (st-yBOLD, a gauge…), used
 * to deposit through the yBOLD Zapper or to withdraw staked shares.
 */
export type VaultVariant = 'unlocked' | 'locked' | 'staked';

/**
 * Where a locked position sits in the withdrawal cycle.
 * `none` — nothing deposited into the locked vault.
 * `idle` — locked shares held, no cooldown armed.
 * `cooling` / `ready` / `expired` — mirror `LockedyvUSD.availableWithdrawLimit`.
 */
export type LockedPhase = 'none' | 'idle' | 'cooling' | 'ready' | 'expired';

export interface LockedState {
  isLocked: boolean;
  phase: LockedPhase;
  cooldownEnd: number;
  windowEnd: number;
  cooldownShares: bigint;
  /** Base-asset value of the cooled-down shares that can be redeemed now. */
  cooldownAssets: bigint;
  cooldownDays: number;
  windowDays: number;
  /** Seconds until the current phase ends (cooldown expiry, or window close). */
  secondsLeft: number;
}

export interface ApprovalInfo {
  /** "Vault", "yBOLD Zap", "Yearn Zap". */
  spender: string;
  amount: bigint;
  symbol: string;
  decimals: number;
}

export interface VaultActions {
  amount: string;
  setAmount: (value: string) => void;
  parsedAmount: bigint;
  /** The whole position is being withdrawn — set by Max, cleared by typing. */
  isMax: boolean;
  position: VaultPosition | null;
  isLoadingBalances: boolean;
  /** Spendable balance for the active mode, in the deposit asset. */
  available: bigint;
  /** Withdraw sources that hold anything. */
  sources: WithdrawSource[];
  /** Shares the action burns (withdraw) or mints (deposit), in the variant's units. */
  sharesPreview: bigint;
  sharesSymbol: string;
  /** Allowance relevant to the active route, if the route needs one. */
  approval: ApprovalInfo | null;
  /** Why the action cannot run with the current input. */
  blockedReason: string | null;
  isWrongChain: boolean;
  status: ActionStatus;
  locked: LockedState;
  resetStatus: () => void;
  setPercent: (percent: number) => void;
  execute: () => Promise<void>;
  startCooldown: () => Promise<void>;
  cancelCooldown: () => Promise<void>;
  switchToVaultChain: () => Promise<void>;
  refreshBalances: () => Promise<void>;
}

const DAY_SECONDS = 86400;
const WAD = 10n ** 18n;

const IDLE_LOCKED_STATE: LockedState = {
  isLocked: false,
  phase: 'none',
  cooldownEnd: 0,
  windowEnd: 0,
  cooldownShares: 0n,
  cooldownAssets: 0n,
  cooldownDays: YVUSD_COOLDOWN_DAYS,
  windowDays: YVUSD_WITHDRAW_WINDOW_DAYS,
  secondsLeft: 0,
};

interface LockedPosition {
  shares: bigint;
  /** Base-asset value of all locked shares. */
  assets: bigint;
  maxRedeem: bigint;
  /** Locked shares approved to the LockerZapper. */
  zapAllowance: bigint;
  /** yvUSD per 1e18 locked shares. */
  pricePerShare: bigint;
}

function parseAmount(value: string, decimals: number): bigint {
  if (!value || !/^\d*\.?\d+$/.test(value) || value === '0' || /^0\.0*$/.test(value)) return 0n;
  try {
    const [intPart = '0', fracRaw = ''] = value.trim().split('.');
    const fracPart = fracRaw.slice(0, decimals).padEnd(decimals, '0');
    return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPart || '0');
  } catch {
    return 0n;
  }
}

const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

/** Wallet reads/writes for the deposit-withdraw widget, kept out of the presentation layer. */
export function useVaultActions(
  vault: YearnVault,
  mode: WidgetMode,
  walletAddress?: string,
  walletChainId?: number,
  variant: VaultVariant = 'unlocked'
): VaultActions {
  const [amount, setAmountState] = useState('');
  const [isMax, setIsMax] = useState(false);
  const [position, setPosition] = useState<VaultPosition | null>(null);
  const [lockedPosition, setLockedPosition] = useState<LockedPosition | null>(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [status, setStatus] = useState<ActionStatus>({ stage: 'idle' });
  const [locked, setLocked] = useState<LockedState>(IDLE_LOCKED_STATE);
  const [schedule, setSchedule] = useState<{ cooldownDays: number; windowDays: number }>({
    cooldownDays: YVUSD_COOLDOWN_DAYS,
    windowDays: YVUSD_WITHDRAW_WINDOW_DAYS,
  });
  const readRunRef = useRef(0);

  const decimals = vault.token.decimals || 18;
  const vaultDecimals = shareDecimals(vault);
  const isWrongChain = Boolean(walletAddress && walletChainId && walletChainId !== vault.chainID);

  const lockedAddress = vault.lockedTwin?.address;
  const isLocked = variant === 'locked' && Boolean(lockedAddress);
  const staking = getStaking(vault);
  const isStaked = variant === 'staked' && staking !== null;
  const source: WithdrawSource = isStaked ? 'staking' : 'vault';
  const stakeOnDeposit = isStaked && canStakeOnDeposit(vault);

  const setAmount = useCallback((value: string) => {
    setAmountState(value);
    setIsMax(false);
  }, []);

  // The cooldown schedule is public state, so the info box stays accurate
  // even before a wallet connects.
  useEffect(() => {
    if (!lockedAddress) return;
    let cancelled = false;
    void fetchLockedSchedule(vault.chainID, lockedAddress).then((result) => {
      if (cancelled || !result) return;
      setSchedule({
        cooldownDays: Math.round(result.cooldownDuration / DAY_SECONDS),
        windowDays: Math.round(result.withdrawalWindow / DAY_SECONDS),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vault.chainID, lockedAddress]);

  const refreshBalances = useCallback(async () => {
    const runId = ++readRunRef.current;
    const isStale = () => readRunRef.current !== runId;

    if (!walletAddress) {
      setPosition(null);
      setLockedPosition(null);
      setLocked(IDLE_LOCKED_STATE);
      return;
    }

    setIsLoadingBalances(true);
    try {
      const nextPosition = await readVaultPosition(vault, walletAddress);
      if (isStale()) return;
      setPosition(nextPosition);

      if (!lockedAddress) {
        setLockedPosition(null);
        setLocked(IDLE_LOCKED_STATE);
        return;
      }

      const owner = walletAddress as `0x${string}`;
      const lockedVault = lockedAddress as `0x${string}`;
      const reads = await readContracts(wagmiConfig, {
        allowFailure: true,
        contracts: [
          { chainId: vault.chainID, address: lockedVault, abi: V3_VAULT_ABI, functionName: 'balanceOf', args: [owner] },
          { chainId: vault.chainID, address: lockedVault, abi: V3_VAULT_ABI, functionName: 'maxRedeem', args: [owner] },
          { chainId: vault.chainID, address: lockedVault, abi: V3_VAULT_ABI, functionName: 'pricePerShare' },
          {
            chainId: vault.chainID,
            address: lockedVault,
            abi: ERC20_TX_ABI,
            functionName: 'allowance',
            args: [owner, YVUSD_ZAP_ADDRESS as `0x${string}`],
          },
        ] as any,
      });
      const read = (index: number) =>
        reads[index]?.status === 'success' ? (reads[index].result as bigint) : 0n;
      const shares = read(0);
      const cooldown = await fetchLockedCooldown(vault.chainID, lockedAddress, walletAddress);
      // `maxRedeem` is the cooled-down shares minus one wei; asking the zapper
      // for all of them reverts with "redeem more than max".
      const maxRedeem = read(1);
      const redeemable = minBig(cooldown.shares, maxRedeem);
      const [assets, cooldownAssets] = await Promise.all([
        shares > 0n ? previewZapOut(vault.chainID, YVUSD_ZAP_ADDRESS, shares) : Promise.resolve(0n),
        redeemable > 0n
          ? previewZapOut(vault.chainID, YVUSD_ZAP_ADDRESS, redeemable)
          : Promise.resolve(0n),
      ]);
      if (isStale()) return;

      setLockedPosition({
        shares,
        assets,
        maxRedeem,
        zapAllowance: read(3),
        pricePerShare: read(2) || WAD,
      });

      const now = Math.floor(Date.now() / 1000);
      let phase: LockedPhase = shares > 0n ? 'idle' : 'none';
      let secondsLeft = 0;
      if (cooldown.shares > 0n) {
        if (now < cooldown.cooldownEnd) {
          phase = 'cooling';
          secondsLeft = cooldown.cooldownEnd - now;
        } else if (now <= cooldown.windowEnd) {
          phase = 'ready';
          secondsLeft = cooldown.windowEnd - now;
        } else {
          phase = 'expired';
        }
      }
      setLocked({
        isLocked: true,
        phase,
        cooldownEnd: cooldown.cooldownEnd,
        windowEnd: cooldown.windowEnd,
        cooldownShares: cooldown.shares,
        cooldownAssets,
        // `cooldownDays`/`windowDays` come from the shared schedule below.
        cooldownDays: YVUSD_COOLDOWN_DAYS,
        windowDays: YVUSD_WITHDRAW_WINDOW_DAYS,
        secondsLeft,
      });
    } catch (err) {
      console.warn('[useVaultActions] Error loading balances:', err);
    } finally {
      if (!isStale()) setIsLoadingBalances(false);
    }
  }, [vault, walletAddress, lockedAddress]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  // The amount is denominated in the deposit asset in both directions.
  const parsedAmount = parseAmount(amount, decimals);

  const available = useMemo(() => {
    if (mode === 'deposit') {
      const balance = position?.assetBalance ?? 0n;
      const limit = isLocked || stakeOnDeposit ? null : position?.depositLimit ?? null;
      return limit === null ? balance : minBig(balance, limit);
    }
    if (isLocked) {
      if (!lockedPosition) return 0n;
      return locked.phase === 'ready' ? locked.cooldownAssets : lockedPosition.assets;
    }
    return position ? withdrawableAssets(vault, position, source) : 0n;
  }, [mode, position, isLocked, stakeOnDeposit, lockedPosition, locked.phase, locked.cooldownAssets, vault, source]);

  const effectiveMax = mode === 'withdraw' && (isMax || (parsedAmount > 0n && parsedAmount >= available));

  const sources = useMemo(() => fundedSources(vault, position), [vault, position]);

  /** Locked shares matching the typed amount, proportional to their value. */
  const lockedSharesFor = useCallback(
    (assets: bigint, shares: bigint) => {
      if (shares === 0n) return 0n;
      if (assets === 0n || parsedAmount >= assets) return shares;
      return (shares * parsedAmount) / assets;
    },
    [parsedAmount]
  );

  const sharesPreview = useMemo(() => {
    if (!position) return 0n;
    const pps = position.pricePerShare;
    if (mode === 'deposit') {
      if (pps === 0n) return 0n;
      const vaultShares = (parsedAmount * 10n ** BigInt(vaultDecimals)) / pps;
      if (isLocked && lockedPosition) return (vaultShares * WAD) / lockedPosition.pricePerShare;
      if (stakeOnDeposit && position.stakingPricePerShare) {
        return (vaultShares * WAD) / position.stakingPricePerShare;
      }
      return vaultShares;
    }
    if (isLocked) {
      return locked.phase === 'ready'
        ? minBig(lockedSharesFor(locked.cooldownAssets, locked.cooldownShares), lockedPosition?.maxRedeem ?? 0n)
        : lockedSharesFor(lockedPosition?.assets ?? 0n, lockedPosition?.shares ?? 0n);
    }
    if (source === 'vault') {
      const max = maxVaultShares(position);
      return effectiveMax ? max : minBig(assetsToShares(parsedAmount, pps, vaultDecimals), max);
    }
    const max = maxStakingShares(position);
    if (effectiveMax) return max;
    const vaultShares = assetsToShares(parsedAmount, pps, vaultDecimals);
    if (staking?.kind === 'ybold' && position.stakingPricePerShare) {
      return minBig((vaultShares * WAD + position.stakingPricePerShare - 1n) / position.stakingPricePerShare, max);
    }
    return minBig(vaultShares, max);
  }, [
    position,
    mode,
    parsedAmount,
    vaultDecimals,
    isLocked,
    lockedPosition,
    stakeOnDeposit,
    locked.phase,
    locked.cooldownAssets,
    locked.cooldownShares,
    lockedSharesFor,
    source,
    effectiveMax,
    staking,
  ]);

  const sharesSymbol = isLocked
    ? 'Locked Vault Shares'
    : isStaked && staking?.kind === 'ybold'
      ? 'st-yBOLD'
      : isStaked
        ? 'Staked shares'
        : vault.symbol;

  const approval = useMemo<ApprovalInfo | null>(() => {
    if (!position) return null;
    const asset = { symbol: vault.token.symbol, decimals };
    if (mode === 'deposit') {
      if (isLocked) {
        return { spender: 'Yearn Zap', amount: position.assetAllowance[YVUSD_ZAP_ADDRESS.toLowerCase()] ?? 0n, ...asset };
      }
      if (stakeOnDeposit) {
        return { spender: 'yBOLD Zap', amount: position.assetAllowance[YBOLD_ZAPPER_ADDRESS.toLowerCase()] ?? 0n, ...asset };
      }
      return { spender: 'Vault', amount: position.assetAllowance[vault.address.toLowerCase()] ?? 0n, ...asset };
    }
    if (isLocked) {
      return {
        spender: 'Yearn Zap',
        amount: lockedPosition?.zapAllowance ?? 0n,
        symbol: vault.symbol,
        decimals: vaultDecimals,
      };
    }
    if (isStaked && staking?.kind === 'ybold') {
      return { spender: 'yBOLD Zap', amount: position.stakingZapAllowance, symbol: 'st-yBOLD', decimals: 18 };
    }
    return null;
  }, [position, vault, decimals, vaultDecimals, mode, isLocked, stakeOnDeposit, lockedPosition, isStaked, staking]);

  const blockedReason = useMemo(() => {
    if (!walletAddress || !position) return null;
    if (mode === 'deposit') {
      if (isDepositClosed(vault)) return 'Deposits are disabled for this vault.';
      const limit = isLocked || stakeOnDeposit ? null : position.depositLimit;
      if (limit === 0n) return 'This vault is not accepting deposits right now.';
      if (parsedAmount > position.assetBalance) return 'Insufficient balance';
      if (limit !== null && parsedAmount > limit) return 'Amount exceeds the vault deposit limit.';
      return null;
    }
    if (parsedAmount > available) return 'Insufficient balance';
    return null;
  }, [walletAddress, position, mode, vault, isLocked, stakeOnDeposit, parsedAmount, available]);

  const resetStatus = useCallback(() => setStatus({ stage: 'idle' }), []);

  const setPercent = useCallback(
    (percent: number) => {
      if (available === 0n) return;
      const portion = percent >= 100 ? available : (available * BigInt(percent)) / 100n;
      setAmountState(formatUnits(portion, decimals));
      setIsMax(percent >= 100);
    },
    [available, decimals]
  );

  const switchToVaultChain = useCallback(async () => {
    try {
      await switchChain(wagmiConfig, { chainId: vault.chainID as any });
    } catch (err) {
      console.error('[useVaultActions] Switch network error:', err);
    }
  }, [vault.chainID]);

  const fail = useCallback((err: any, fallback: string) => {
    console.error('[useVaultActions]', fallback, err);
    const message = err?.shortMessage || err?.message;
    setStatus({ stage: 'error', message: message?.slice(0, 200) || fallback });
  }, []);

  /** Right after a receipt a load-balanced RPC may still answer from the
   *  previous block, so read again a few seconds later. */
  const refreshAfterTx = useCallback(() => {
    void refreshBalances();
    window.setTimeout(() => void refreshBalances(), 4000);
  }, [refreshBalances]);

  const run = useCallback(
    async (steps: TxStep[]) => {
      if (!walletAddress) return;
      const hash = await runPlan(steps, walletAddress, (step) => {
        const approving = /^(Approve|Reset)/.test(step.label);
        setStatus({ stage: approving ? 'approving' : 'executing', step });
      });
      setStatus({ stage: 'success', txHash: hash });
      setAmount('');
      refreshAfterTx();
    },
    [walletAddress, setAmount, refreshAfterTx]
  );

  const startCooldown = useCallback(async () => {
    if (!walletAddress || !lockedAddress || !lockedPosition) return;
    // With no amount typed, arm the cooldown for the whole locked position.
    const shares =
      parsedAmount === 0n
        ? lockedPosition.shares
        : lockedSharesFor(lockedPosition.assets, lockedPosition.shares);
    if (shares === 0n) return;
    try {
      setStatus({ stage: 'executing' });
      const hash = await startLockedCooldown(vault.chainID, lockedAddress, shares);
      setStatus({ stage: 'success', txHash: hash });
      refreshAfterTx();
    } catch (err: any) {
      fail(err, 'Could not start the cooldown.');
    }
  }, [walletAddress, lockedAddress, lockedPosition, parsedAmount, lockedSharesFor, vault.chainID, refreshAfterTx, fail]);

  const cancelCooldown = useCallback(async () => {
    if (!walletAddress || !lockedAddress) return;
    try {
      setStatus({ stage: 'executing' });
      const hash = await cancelLockedCooldown(vault.chainID, lockedAddress);
      setStatus({ stage: 'success', txHash: hash });
      refreshAfterTx();
    } catch (err: any) {
      fail(err, 'Could not cancel the cooldown.');
    }
  }, [walletAddress, lockedAddress, vault.chainID, refreshAfterTx, fail]);

  const execute = useCallback(async () => {
    if (!walletAddress || !position || parsedAmount === 0n || blockedReason) return;
    if (isWrongChain) {
      await switchToVaultChain();
      return;
    }

    try {
      setStatus({ stage: 'executing' });
      const chainId = vault.chainID;
      let steps: TxStep[];

      if (mode === 'deposit' && isLocked) {
        const zap = YVUSD_ZAP_ADDRESS.toLowerCase();
        steps = [
          ...approvalSteps(chainId, vault.token.address, zap, parsedAmount, position.assetAllowance[zap] ?? 0n, vault.token.symbol),
          {
            label: 'Deposit',
            call: {
              chainId,
              address: YVUSD_ZAP_ADDRESS as `0x${string}`,
              abi: LOCKED_ZAP_ABI,
              functionName: 'zapIn',
              args: [parsedAmount, walletAddress as `0x${string}`],
            },
          },
        ];
      } else if (mode === 'deposit') {
        steps = planDeposit(vault, position, parsedAmount, walletAddress, { stake: stakeOnDeposit });
      } else if (isLocked) {
        if (locked.phase !== 'ready' || !lockedAddress || !lockedPosition) return;
        const shares = sharesPreview;
        if (shares === 0n) return;
        steps = [
          ...approvalSteps(chainId, lockedAddress, YVUSD_ZAP_ADDRESS, shares, lockedPosition.zapAllowance, vault.symbol),
          {
            label: 'Withdraw',
            call: {
              chainId,
              address: YVUSD_ZAP_ADDRESS as `0x${string}`,
              abi: LOCKED_ZAP_ABI,
              functionName: 'zapOut',
              args: [shares, walletAddress as `0x${string}`],
            },
          },
        ];
      } else {
        const plan = await planWithdraw(vault, position, source, parsedAmount, effectiveMax, walletAddress);
        if (plan.sharesIn === 0n) {
          setStatus({ stage: 'idle' });
          return;
        }
        steps = plan.steps;
      }

      await run(steps);
    } catch (err: any) {
      fail(err, 'Transaction was rejected or failed.');
    }
  }, [
    walletAddress,
    position,
    parsedAmount,
    blockedReason,
    isWrongChain,
    switchToVaultChain,
    vault,
    mode,
    isLocked,
    stakeOnDeposit,
    locked.phase,
    lockedAddress,
    lockedPosition,
    sharesPreview,
    source,
    effectiveMax,
    run,
    fail,
  ]);

  return {
    amount,
    setAmount,
    parsedAmount,
    isMax: effectiveMax,
    position,
    isLoadingBalances,
    available,
    sources,
    sharesPreview,
    sharesSymbol,
    approval,
    blockedReason,
    isWrongChain,
    status,
    locked: { ...locked, ...schedule },
    resetStatus,
    setPercent,
    execute,
    startCooldown,
    cancelCooldown,
    switchToVaultChain,
    refreshBalances,
  };
}

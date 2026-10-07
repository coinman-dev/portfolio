import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { getBalance, readContracts, switchChain } from '@wagmi/core';
import { YearnVault } from '../types';
import { wagmiConfig } from '../../wallet/wallet';
import {
  ENSO_ROUTERS,
  YVUSD_COOLDOWN_DAYS,
  YVUSD_WITHDRAW_WINDOW_DAYS,
  YVUSD_ZAP_ADDRESS,
  ZAP_SLIPPAGE_DEFAULT,
} from '../constants';
import { isNativeToken } from '../ensoApi';
import { ZapRequest, quoteZap } from '../zapQuote';
import { ZapToken, useZapQuote } from './useZap';
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
  planStake,
  planWithdraw,
  planZap,
  readVaultPosition,
  runPlan,
  shareDecimals,
  sharesToAssets,
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
  /** Decimals the typed amount is parsed with (the zap input token's on deposit). */
  inputDecimals: number;
  /** Set while an Enso route is the active route. */
  zap: ZapInfo | null;
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
  /** Stakes every vault share the wallet holds outside the staking contract. */
  stakeShares: () => Promise<void>;
  startCooldown: () => Promise<void>;
  cancelCooldown: () => Promise<void>;
  switchToVaultChain: () => Promise<void>;
  refreshBalances: () => Promise<void>;
}

const DAY_SECONDS = 86400;
const WAD = 10n ** 18n;
/** Gas money kept back when spending the native token: ~350k gas at 20 gwei, +20%. */
const NATIVE_GAS_RESERVE = (350_000n * 20_000_000_000n * 12n) / 10n;

export interface ZapInfo {
  isQuoting: boolean;
  error: string | null;
  /** What the route guarantees / expects to pay out. */
  minOut: bigint | null;
  expectedOut: bigint | null;
  outSymbol: string;
  outDecimals: number;
  inputSymbol: string;
  /** Percent. */
  estImpact: number | null;
  worstImpact: number | null;
}

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
  variant: VaultVariant = 'unlocked',
  /** Deposit input / withdrawal output other than the vault's asset (Enso). */
  zapToken: ZapToken | null = null,
  slippagePct: number = ZAP_SLIPPAGE_DEFAULT
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

  // Any token but the deposit asset goes through an Enso route. Withdrawals
  // zap only out of the vault itself; staking contracts keep their own exits.
  const isZap =
    Boolean(zapToken && !zapToken.isAsset) && !isLocked && (mode === 'deposit' || !isStaked);
  const router = ENSO_ROUTERS[vault.chainID];
  const zapTokenIn = !isZap ? null : mode === 'deposit' ? (zapToken as ZapToken).address : vault.address;
  const [zapWallet, setZapWallet] = useState<{ balance: bigint; allowance: bigint } | null>(null);

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

  /** Balance and router allowance of the token an Enso route spends. */
  const refreshZap = useCallback(async () => {
    if (!zapTokenIn || !walletAddress || !router) {
      setZapWallet(null);
      return;
    }
    const owner = walletAddress as `0x${string}`;
    try {
      if (isNativeToken(zapTokenIn)) {
        const { value } = await getBalance(wagmiConfig, { address: owner, chainId: vault.chainID as any });
        setZapWallet({ balance: value, allowance: 0n });
        return;
      }
      const token = zapTokenIn as `0x${string}`;
      const reads = await readContracts(wagmiConfig, {
        allowFailure: true,
        contracts: [
          { chainId: vault.chainID, address: token, abi: ERC20_TX_ABI, functionName: 'balanceOf', args: [owner] },
          {
            chainId: vault.chainID,
            address: token,
            abi: ERC20_TX_ABI,
            functionName: 'allowance',
            args: [owner, router as `0x${string}`],
          },
        ] as any,
      });
      const read = (index: number) =>
        reads[index]?.status === 'success' ? (reads[index].result as bigint) : 0n;
      setZapWallet({ balance: read(0), allowance: read(1) });
    } catch (err) {
      console.warn('[useVaultActions] Error loading zap token balance:', err);
      setZapWallet(null);
    }
  }, [zapTokenIn, walletAddress, router, vault.chainID]);

  useEffect(() => {
    void refreshZap();
  }, [refreshZap]);

  // Deposits are typed in the token being spent; withdrawals always in the
  // deposit asset, whatever token comes out.
  const inputDecimals = isZap && mode === 'deposit' ? (zapToken as ZapToken).decimals : decimals;
  const parsedAmount = parseAmount(amount, inputDecimals);

  const available = useMemo(() => {
    if (isZap && mode === 'deposit') {
      const balance = zapWallet?.balance ?? 0n;
      // Leave gas money when spending the native token (yearn.fi reserves
      // about the route's gas at 20 gwei, plus 20%).
      if (zapTokenIn && isNativeToken(zapTokenIn)) {
        return balance > NATIVE_GAS_RESERVE ? balance - NATIVE_GAS_RESERVE : 0n;
      }
      return balance;
    }
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
  }, [
    isZap,
    zapWallet,
    zapTokenIn,
    mode,
    position,
    isLocked,
    stakeOnDeposit,
    lockedPosition,
    locked.phase,
    locked.cooldownAssets,
    vault,
    source,
  ]);

  const effectiveMax = mode === 'withdraw' && (isMax || (parsedAmount > 0n && parsedAmount >= available));

  /** What the Enso route spends: the typed tokens, or the vault shares the
   *  typed asset amount maps to. */
  const zapAmountIn = useMemo(() => {
    if (!isZap || !position) return 0n;
    if (mode === 'deposit') return parsedAmount;
    const max = maxVaultShares(position);
    return effectiveMax
      ? max
      : minBig(assetsToShares(parsedAmount, position.pricePerShare, vaultDecimals), max);
  }, [isZap, position, mode, parsedAmount, effectiveMax, vaultDecimals]);

  const zapRequest = useMemo<ZapRequest | null>(() => {
    if (!isZap || !zapToken || !walletAddress || !position || zapAmountIn === 0n) return null;
    const chainId = vault.chainID;
    if (mode === 'deposit') {
      // Yearn BOLD's staked variant zaps straight into st-yBOLD.
      const toStaking = stakeOnDeposit && staking !== null;
      const assetsPerShare =
        toStaking && position.stakingPricePerShare
          ? (position.stakingPricePerShare * position.pricePerShare) / WAD
          : position.pricePerShare;
      return {
        chainId,
        from: walletAddress,
        tokenIn: zapToken.address,
        tokenOut: toStaking ? (staking as { address: string }).address : vault.address,
        amountIn: zapAmountIn,
        valueIn: { token: zapToken.address, decimals: zapToken.decimals, amount: zapAmountIn },
        output: {
          kind: 'shares',
          asset: vault.token.address,
          assetDecimals: decimals,
          assetsPerShare,
          shareDecimals: toStaking ? 18 : vaultDecimals,
        },
        tolerancePct: slippagePct,
      };
    }
    const assets = effectiveMax
      ? sharesToAssets(zapAmountIn, position.pricePerShare, vaultDecimals)
      : parsedAmount;
    return {
      chainId,
      from: walletAddress,
      tokenIn: vault.address,
      tokenOut: zapToken.address,
      amountIn: zapAmountIn,
      valueIn: { token: vault.token.address, decimals, amount: assets },
      output: { kind: 'token', token: zapToken.address, decimals: zapToken.decimals },
      tolerancePct: slippagePct,
    };
  }, [
    isZap,
    zapToken,
    walletAddress,
    position,
    zapAmountIn,
    vault,
    mode,
    stakeOnDeposit,
    staking,
    decimals,
    vaultDecimals,
    slippagePct,
    effectiveMax,
    parsedAmount,
  ]);

  const zapState = useZapQuote(zapRequest);

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
    if (isZap) return mode === 'deposit' ? zapState.quote?.route.minAmountOut ?? 0n : zapAmountIn;
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
    isZap,
    zapState.quote,
    zapAmountIn,
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
    if (isZap && zapToken) {
      if (zapTokenIn && isNativeToken(zapTokenIn)) return null;
      return mode === 'deposit'
        ? { spender: 'Enso Router', amount: zapWallet?.allowance ?? 0n, symbol: zapToken.symbol, decimals: zapToken.decimals }
        : { spender: 'Enso Router', amount: zapWallet?.allowance ?? 0n, symbol: vault.symbol, decimals: vaultDecimals };
    }
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
  }, [
    position,
    vault,
    decimals,
    vaultDecimals,
    mode,
    isLocked,
    stakeOnDeposit,
    lockedPosition,
    isStaked,
    staking,
    isZap,
    zapToken,
    zapTokenIn,
    zapWallet,
  ]);

  const blockedReason = useMemo(() => {
    if (!walletAddress || !position) return null;
    if (isZap) {
      if (mode === 'deposit' && isDepositClosed(vault)) return 'Deposits are disabled for this vault.';
      if (parsedAmount > available) return 'Insufficient balance';
      if (zapState.error) return zapState.error;
      if (zapState.quote?.blocked) return zapState.quote.blocked;
      return null;
    }
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
  }, [
    walletAddress,
    position,
    mode,
    vault,
    isLocked,
    stakeOnDeposit,
    parsedAmount,
    available,
    isZap,
    zapState.error,
    zapState.quote,
  ]);

  const resetStatus = useCallback(() => setStatus({ stage: 'idle' }), []);

  const setPercent = useCallback(
    (percent: number) => {
      if (available === 0n) return;
      const portion = percent >= 100 ? available : (available * BigInt(percent)) / 100n;
      setAmountState(formatUnits(portion, inputDecimals));
      setIsMax(percent >= 100);
    },
    [available, inputDecimals]
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
    void refreshZap();
    window.setTimeout(() => {
      void refreshBalances();
      void refreshZap();
    }, 4000);
  }, [refreshBalances, refreshZap]);

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

  const stakeShares = useCallback(async () => {
    if (!walletAddress || !position || position.vaultShares === 0n) return;
    if (isWrongChain) {
      await switchToVaultChain();
      return;
    }
    try {
      setStatus({ stage: 'executing' });
      await run(planStake(vault, position, position.vaultShares, position.stakeAllowance, walletAddress));
    } catch (err: any) {
      fail(err, 'Could not stake the vault shares.');
    }
  }, [walletAddress, position, isWrongChain, switchToVaultChain, vault, run, fail]);

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

      if (isZap) {
        if (!zapRequest || !zapToken) return;
        // Never send the quote on screen: it may be stale. Quote again, with
        // the same protection, and send only if it still passes.
        const quote = await quoteZap(zapRequest);
        if (quote.blocked) throw new Error(quote.blocked);
        steps = planZap(
          chainId,
          zapRequest.tokenIn,
          mode === 'deposit' ? zapToken.symbol : vault.symbol,
          zapRequest.amountIn,
          zapWallet?.allowance ?? 0n,
          quote.route,
          mode === 'deposit' ? 'Deposit' : 'Withdraw'
        );
      } else if (mode === 'deposit' && isLocked) {
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
    isZap,
    zapRequest,
    zapToken,
    zapWallet,
  ]);

  const zap = useMemo<ZapInfo | null>(() => {
    if (!isZap || !zapToken) return null;
    const quote = zapState.quote;
    const deposit = mode === 'deposit';
    return {
      isQuoting: zapState.isQuoting,
      error: zapState.error,
      minOut: quote?.route.minAmountOut ?? null,
      expectedOut: quote?.route.amountOut ?? null,
      outSymbol: deposit ? sharesSymbol : zapToken.symbol,
      outDecimals: deposit ? (stakeOnDeposit ? 18 : vaultDecimals) : zapToken.decimals,
      inputSymbol: deposit ? zapToken.symbol : vault.token.symbol,
      estImpact: quote?.estImpact ?? null,
      worstImpact: quote?.worstImpact ?? null,
    };
  }, [isZap, zapToken, zapState, mode, sharesSymbol, stakeOnDeposit, vaultDecimals, vault.token.symbol]);

  return {
    amount,
    setAmount,
    parsedAmount,
    inputDecimals,
    isMax: effectiveMax,
    position,
    isLoadingBalances,
    available,
    sources,
    sharesPreview,
    sharesSymbol,
    approval,
    blockedReason,
    zap,
    isWrongChain,
    status,
    locked: { ...locked, ...schedule },
    resetStatus,
    setPercent,
    execute,
    stakeShares,
    startCooldown,
    cancelCooldown,
    switchToVaultChain,
    refreshBalances,
  };
}

import { getTransactionReceipt } from '@wagmi/core';
import { wagmiConfig } from '../../wallet/wallet';
import { diag } from '../../diag';
import { ProviderId, QuoteRequest } from './types';
import { ExecPlan, StatusRef } from './execute/plan';
import { RunProgress, RunStep } from './execute/run';
import { watchDelivery } from './execute/status';

/**
 * Swaps sent from Best Rate, stored in data/exchange-history.json (newest
 * first, capped on the Rust side). A record appears with the first real
 * transaction — cancelling in the wallet before that leaves no trace.
 */

export type SwapStatus = 'sending' | 'pending' | 'done' | 'refunded' | 'failed' | 'cancelled';

export interface SwapRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  provider: ProviderId;
  providerName: string;
  via: string;
  from: { chainId: number; chainName: string; symbol: string; address: string; decimals: number; amount: string };
  to: {
    chainId: number;
    chainName: string;
    symbol: string;
    address: string;
    decimals: number;
    expected: string;
    min: string;
  };
  user: string;
  receiver: string;
  txs: { step: RunStep; hash: string }[];
  /** Source chain explorer, for transaction links. */
  explorer?: string;
  statusRef: StatusRef;
  status: SwapStatus;
  detail?: string;
}

const LOCAL_KEY = 'coinman.exchangeHistory';

function tauriInvoke(): ((cmd: string, args?: unknown) => Promise<any>) | null {
  const invoke = (window as any).__TAURI__?.core?.invoke;
  return typeof invoke === 'function' ? invoke : null;
}

export async function loadHistory(): Promise<SwapRecord[]> {
  const invoke = tauriInvoke();
  if (invoke) {
    try {
      const list = await invoke('load_exchange_history');
      return Array.isArray(list) ? list : [];
    } catch (err) {
      diag('warn', 'BESTRATE', `history could not be read: ${err}`);
      return [];
    }
  }
  // Outside the desktop shell (tests, plain browser) the webview's own storage stands in.
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]');
  } catch {
    return [];
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called after every saved change, so an open history list can reload. */
export function onHistoryChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Saves go out one at a time, in order, so a later status never lands first.
let queue: Promise<void> = Promise.resolve();

export function saveRecord(record: SwapRecord): Promise<void> {
  const stamped = { ...record, updatedAt: Date.now() };
  queue = queue.then(async () => {
    const invoke = tauriInvoke();
    try {
      if (invoke) {
        await invoke('save_exchange_record', { record: stamped });
      } else {
        const list = (await loadHistory()).filter((r) => r.id !== stamped.id);
        localStorage.setItem(LOCAL_KEY, JSON.stringify([stamped, ...list].slice(0, 500)));
      }
      listeners.forEach((listener) => listener());
    } catch (err) {
      diag('error', 'BESTRATE', `history record ${stamped.id} not saved: ${err}`);
    }
  });
  return queue;
}

/** Follows one swap from the first transaction to its outcome, writing each step down. */
export class SwapRecorder {
  private record: SwapRecord | null = null;

  constructor(
    private readonly plan: ExecPlan,
    private readonly req: QuoteRequest
  ) {}

  get started(): boolean {
    return this.record !== null;
  }

  onProgress(progress: RunProgress): void {
    if (!progress.hash) return;
    if (!this.record) this.record = this.create();
    const txs = this.record.txs.filter((tx) => tx.step !== progress.step);
    this.record = { ...this.record, txs: [...txs, { step: progress.step, hash: progress.hash }] };
    if (progress.step === 'swap') this.record.status = 'pending';
    void saveRecord(this.record);
  }

  finish(status: SwapStatus, detail?: string): void {
    if (!this.record) return;
    this.record = { ...this.record, status, detail };
    void saveRecord(this.record);
  }

  private create(): SwapRecord {
    const { plan, req } = this;
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider: plan.provider,
      providerName: plan.providerName,
      via: plan.via,
      from: {
        chainId: req.fromChain.id,
        chainName: req.fromChain.name,
        symbol: req.fromToken.symbol,
        address: req.fromToken.address,
        decimals: req.fromToken.decimals,
        amount: plan.amount.toString(),
      },
      to: {
        chainId: req.toChain.id,
        chainName: req.toChain.name,
        symbol: req.toToken.symbol,
        address: req.toToken.address,
        decimals: req.toToken.decimals,
        expected: plan.toAmount.toString(),
        min: plan.toAmountMin.toString(),
      },
      user: plan.user,
      receiver: plan.receiver,
      txs: [],
      explorer: req.fromChain.explorer,
      statusRef: plan.status,
      status: 'sending',
    };
  }
}

const resuming = new Set<string>();
/** A swap left "sending" without its main transaction this long ago never went out. */
const ABANDONED_MS = 15 * 60_000;

/**
 * Picks up swaps whose outcome was not seen yet — the window or the app was
 * closed while a transfer was on its way — and follows them to the end.
 */
export async function resumePending(signal: AbortSignal): Promise<void> {
  const records = await loadHistory();
  for (const record of records) {
    if (resuming.has(record.id)) continue;
    const swap = record.txs.find((tx) => tx.step === 'swap');
    if (record.status === 'sending' && !swap) {
      if (Date.now() - record.createdAt > ABANDONED_MS) {
        void saveRecord({ ...record, status: 'cancelled', detail: 'the swap itself was never sent' });
      }
      continue;
    }
    if (!swap || (record.status !== 'pending' && record.status !== 'sending')) continue;
    resuming.add(record.id);
    void follow(record, swap.hash, signal).finally(() => resuming.delete(record.id));
  }
}

async function follow(record: SwapRecord, hash: string, signal: AbortSignal): Promise<void> {
  try {
    if (record.statusRef.kind === 'none') {
      // Same-chain swap: its receipt is the whole story.
      const receipt = await getTransactionReceipt(wagmiConfig, {
        hash: hash as `0x${string}`,
        chainId: record.from.chainId as any,
      });
      await saveRecord({
        ...record,
        status: receipt.status === 'success' ? 'done' : 'failed',
        detail: receipt.status === 'success' ? undefined : 'the swap transaction reverted',
      });
      return;
    }
    const result = await watchDelivery(record.statusRef, hash, () => undefined, signal);
    if (signal.aborted || result.state === 'pending') return;
    await saveRecord({ ...record, status: result.state, detail: result.detail });
    diag('info', 'BESTRATE', `history ${record.id}: ${record.providerName} ${result.state}`);
  } catch {
    // Not mined yet or the service is unreachable — the next look will tell.
  }
}

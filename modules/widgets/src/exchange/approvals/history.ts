import { diag } from '../../diag';
import { ApprovalKind, Family } from './types';

/**
 * Revokes sent from Approvals, one record per transaction, kept in
 * data/revoke-history.json (newest first, capped on the Rust side).
 */

export type RevokeStatus = 'pending' | 'done' | 'failed';

export interface RevokeRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  family: Family;
  chainId: number;
  chainName: string;
  owner: string;
  items: { kind: ApprovalKind; token: string; symbol: string; spender: string; spenderName?: string }[];
  /** Transaction hash (Solana: signature). */
  tx?: string;
  status: RevokeStatus;
  detail?: string;
}

const LOCAL_KEY = 'coinman.revokeHistory';

function tauriInvoke(): ((cmd: string, args?: unknown) => Promise<any>) | null {
  const invoke = (window as any).__TAURI__?.core?.invoke;
  return typeof invoke === 'function' ? invoke : null;
}

export async function loadRevokeHistory(): Promise<RevokeRecord[]> {
  const invoke = tauriInvoke();
  if (invoke) {
    try {
      const list = await invoke('load_revoke_history');
      return Array.isArray(list) ? list : [];
    } catch (err) {
      diag('warn', 'APPROVALS', `revoke history could not be read: ${err}`);
      return [];
    }
  }
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]');
  } catch {
    return [];
  }
}

// One save at a time, in order, so a later status never lands first.
let queue: Promise<void> = Promise.resolve();

export function saveRevokeRecord(record: RevokeRecord): Promise<void> {
  const stamped = { ...record, updatedAt: Date.now() };
  queue = queue.then(async () => {
    const invoke = tauriInvoke();
    try {
      if (invoke) {
        await invoke('save_revoke_record', { record: stamped });
      } else {
        const list = (await loadRevokeHistory()).filter((r) => r.id !== stamped.id);
        localStorage.setItem(LOCAL_KEY, JSON.stringify([stamped, ...list].slice(0, 500)));
      }
    } catch (err) {
      diag('error', 'APPROVALS', `revoke record ${stamped.id} not saved: ${err}`);
    }
  });
  return queue;
}

export const newRecordId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

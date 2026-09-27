import { diag } from '../diag';

/**
 * What the wallets need to survive a restart: WalletConnect sessions and the
 * list of wallets. The webview is private and forgets everything on exit, so
 * this lives in data/wallets.json (load_wallet_store / save_wallet_store).
 *
 * modules-common.js reads the file before this bundle runs and leaves it in
 * `window.__COINMAN_WALLET_STORE__`, which is what makes reads synchronous.
 * Writes are batched and flushed shortly after.
 */

const entries = new Map<string, string>(
  Object.entries(((window as any).__COINMAN_WALLET_STORE__ ?? {}) as Record<string, string>),
);

let pending: Record<string, string | null> = {};
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
  const tauri = (window as any).__TAURI__;
  if (!tauri?.core?.invoke) return Promise.resolve();
  return tauri.core.invoke(command, args);
}

function flush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  const items = pending;
  pending = {};
  const count = Object.keys(items).length;
  if (!count) return;
  invoke('save_wallet_store', { items }).catch((e) => {
    diag('error', 'WALLET', `saving ${count} wallet store entries failed: ${e}`);
  });
}

function schedule(key: string, value: string | null): void {
  pending[key] = value;
  if (!flushTimer) flushTimer = setTimeout(flush, 50);
}

// Best effort for the last writes when the window closes.
window.addEventListener('pagehide', flush);

export const walletStore = {
  get(key: string): string | null {
    return entries.get(key) ?? null;
  },
  set(key: string, value: string): void {
    if (entries.get(key) === value) return;
    entries.set(key, value);
    schedule(key, value);
  },
  remove(key: string): void {
    if (!entries.has(key)) return;
    entries.delete(key);
    schedule(key, null);
  },
  keys(): string[] {
    return [...entries.keys()];
  },
};

// Same encoding WalletConnect's own storage uses (@walletconnect/safe-json):
// BigInt round-trips as "123n".
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)) ?? '';
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text, (_, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
  } catch {
    return text;
  }
}

function prefixFor(walletId: string): string {
  return `wc:${walletId}:`;
}

/**
 * Key-value storage for one wallet's WalletConnect client (IKeyValueStorage
 * from @walletconnect/keyvaluestorage). Each wallet gets its own namespace,
 * so their sessions, keys and pairings never mix.
 */
export function walletConnectStorage(walletId: string) {
  const prefix = prefixFor(walletId);
  const keys = () =>
    walletStore
      .keys()
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  return {
    async getKeys(): Promise<string[]> {
      return keys();
    },
    async getEntries<T = any>(): Promise<[string, T][]> {
      return keys().map((k) => [k, parse(walletStore.get(prefix + k)!) as T]);
    },
    async getItem<T = any>(key: string): Promise<T | undefined> {
      const value = walletStore.get(prefix + key);
      return value === null ? undefined : (parse(value) as T);
    },
    async setItem<T = any>(key: string, value: T): Promise<void> {
      walletStore.set(prefix + key, stringify(value));
    },
    async removeItem(key: string): Promise<void> {
      walletStore.remove(prefix + key);
    },
  };
}

/** Drops everything a removed wallet's WalletConnect client left behind. */
export function forgetWalletConnectStorage(walletId: string): void {
  const prefix = prefixFor(walletId);
  for (const key of walletStore.keys()) {
    if (key.startsWith(prefix)) walletStore.remove(key);
  }
}

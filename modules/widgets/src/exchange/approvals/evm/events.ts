import { keccak256, toBytes } from 'viem';
import { EvmScanChain, EventSource } from '../chains';

/**
 * Finds every (token, spender) pair the owner ever approved on one network,
 * from the approval events in its history. Events only say an approval was
 * set at some point; verify.ts then reads what is still in force today.
 */

export const TOPICS = {
  /** ERC-20 (3 topics) and ERC-721 single-token (4 topics) approvals. */
  approval: keccak256(toBytes('Approval(address,address,uint256)')),
  /** ERC-721 / ERC-1155 whole-collection approvals. */
  approvalForAll: keccak256(toBytes('ApprovalForAll(address,address,bool)')),
  /** Permit2 allowance set by a transaction… */
  permit2Approval: keccak256(toBytes('Approval(address,address,address,uint160,uint48)')),
  /** …or by a signed permit someone submitted. */
  permit2Permit: keccak256(toBytes('Permit(address,address,address,uint160,uint48,uint48)')),
};

/** Uniswap's Permit2; zkSync has its own deployment. */
const PERMIT2_DEFAULT = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const PERMIT2_ZKSYNC = '0x0000000000225e31d15943971f47ad3022f714fa';
export const permit2Address = (chainId: number) => (chainId === 324 ? PERMIT2_ZKSYNC : PERMIT2_DEFAULT);

export type CandidateKind = 'token' | 'nft-token' | 'nft-all' | 'permit2';

export interface Candidate {
  kind: CandidateKind;
  token: string;
  spender: string;
  tokenId?: bigint;
  block: number;
  tx?: string;
  time?: number;
}

export interface EventScan {
  candidates: Candidate[];
  source: string;
  note?: string;
}

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  block: number;
  tx?: string;
  time?: number;
}

const ownerTopic = (owner: string) => `0x${owner.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
const topicAddress = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase();
const toNumber = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'string' && value.startsWith('0x') ? parseInt(value, 16) : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** The most pairs looked at per network; older ones beyond it are dropped. */
const MAX_CANDIDATES = 3000;

export function candidatesFrom(logs: RawLog[], chainId: number): Candidate[] {
  const permit2 = permit2Address(chainId);
  const latest = new Map<string, Candidate>();
  for (const log of logs) {
    const topics = log.topics.filter(Boolean).map((t) => t.toLowerCase());
    const address = log.address.toLowerCase();
    let candidate: Omit<Candidate, 'block' | 'tx' | 'time'> | null = null;
    if (topics[0] === TOPICS.approval && topics.length === 3) {
      candidate = { kind: 'token', token: address, spender: topicAddress(topics[2]) };
    } else if (topics[0] === TOPICS.approval && topics.length === 4) {
      candidate = { kind: 'nft-token', token: address, spender: topicAddress(topics[2]), tokenId: BigInt(topics[3]) };
    } else if (topics[0] === TOPICS.approvalForAll && topics.length === 3) {
      candidate = { kind: 'nft-all', token: address, spender: topicAddress(topics[2]) };
    } else if (
      (topics[0] === TOPICS.permit2Approval || topics[0] === TOPICS.permit2Permit) &&
      topics.length === 4 &&
      address === permit2
    ) {
      candidate = { kind: 'permit2', token: topicAddress(topics[2]), spender: topicAddress(topics[3]) };
    }
    if (!candidate) continue;
    const key = `${candidate.kind}:${candidate.token}:${candidate.spender}:${candidate.tokenId ?? ''}`;
    const seen = latest.get(key);
    if (!seen || seen.block <= log.block) {
      latest.set(key, { ...candidate, block: log.block, tx: log.tx, time: log.time });
    }
  }
  return [...latest.values()].sort((a, b) => b.block - a.block).slice(0, MAX_CANDIDATES);
}

// ─── HyperSync (with the user's key) ────────────────────────────────────────

function tauriInvoke(): ((cmd: string, args?: unknown) => Promise<any>) | null {
  const invoke = (window as any).__TAURI__?.core?.invoke;
  return typeof invoke === 'function' ? invoke : null;
}

/** Stops after this many pages; one page usually covers the whole history. */
const HYPERSYNC_MAX_PAGES = 40;

async function hypersyncLogs(chainId: number, owner: string, key: string, signal: AbortSignal): Promise<RawLog[]> {
  // HyperSync sends no CORS headers, so the request goes out from the app (approvals.rs).
  const invoke = tauriInvoke();
  const query = (fromBlock: number) => ({
    from_block: fromBlock,
    logs: [
      { topics: [[TOPICS.approval, TOPICS.approvalForAll], [ownerTopic(owner)]] },
      {
        address: [permit2Address(chainId)],
        topics: [[TOPICS.permit2Approval, TOPICS.permit2Permit], [ownerTopic(owner)]],
      },
    ],
    field_selection: {
      log: ['block_number', 'transaction_hash', 'log_index', 'address', 'data', 'topic0', 'topic1', 'topic2', 'topic3'],
      block: ['number', 'timestamp'],
    },
  });
  const logs: RawLog[] = [];
  let from = 0;
  for (let page = 0; page < HYPERSYNC_MAX_PAGES; page++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const body = invoke
      ? await invoke('approvals_hypersync', { chainId, token: key, query: query(from) })
      : await fetch(`https://${chainId}.hypersync.xyz/query`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(query(from)),
          signal,
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HyperSync ${res.status}: ${(await res.text()).slice(0, 160)}`);
          return res.json();
        });
    const batches: any[] = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    for (const batch of batches) {
      const times = new Map<number, number>();
      for (const block of batch.blocks ?? []) {
        const n = toNumber(block.number);
        const t = toNumber(block.timestamp);
        if (n != null && t != null) times.set(n, t);
      }
      for (const log of batch.logs ?? []) {
        const block = toNumber(log.block_number) ?? 0;
        logs.push({
          address: log.address,
          topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(Boolean),
          data: log.data ?? '0x',
          block,
          tx: log.transaction_hash,
          time: times.get(block),
        });
      }
    }
    const next = toNumber(body?.next_block);
    const height = toNumber(body?.archive_height);
    if (next == null || height == null || next >= height || next <= from) break;
    from = next;
  }
  return logs;
}

/** Free endpoints throttle bursts (HTTP 429); waiting a moment is enough. */
async function fetchPatiently(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal });
    if (res.status !== 429 || attempt >= 5) return res;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }
}

// ─── Blockscout (keyless) ───────────────────────────────────────────────────

/** Blockscout returns at most this many logs per call. */
const BLOCKSCOUT_PAGE = 1000;
const BLOCKSCOUT_MAX_PAGES = 30;

async function blockscoutLogs(
  host: string,
  filter: { topic0: string; address?: string },
  owner: string,
  signal: AbortSignal
): Promise<{ logs: RawLog[]; truncated: boolean }> {
  const logs: RawLog[] = [];
  const seen = new Set<string>();
  let from = 0;
  for (let page = 0; page < BLOCKSCOUT_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      module: 'logs',
      action: 'getLogs',
      fromBlock: String(from),
      toBlock: 'latest',
      topic0: filter.topic0,
      topic1: ownerTopic(owner),
      topic0_1_opr: 'and',
    });
    if (filter.address) params.set('address', filter.address);
    const res = await fetchPatiently(`https://${host}/api?${params}`, {}, signal);
    if (!res.ok) throw new Error(`${host} answered ${res.status}`);
    const body = await res.json();
    const result = Array.isArray(body?.result) ? body.result : [];
    if (!Array.isArray(body?.result) && !/no (logs|records) found/i.test(String(body?.message))) {
      throw new Error(`${host}: ${String(body?.result ?? body?.message ?? 'unexpected answer').slice(0, 120)}`);
    }
    let last = from;
    for (const item of result) {
      const id = `${item.transactionHash}:${item.logIndex}`;
      const block = toNumber(item.blockNumber) ?? 0;
      last = Math.max(last, block);
      if (seen.has(id)) continue;
      seen.add(id);
      logs.push({
        address: item.address,
        topics: (item.topics ?? []).filter(Boolean),
        data: item.data ?? '0x',
        block,
        tx: item.transactionHash,
        time: toNumber(item.timeStamp),
      });
    }
    if (result.length < BLOCKSCOUT_PAGE) return { logs, truncated: false };
    // A full page: carry on from its last block (logs of that block come again and are skipped).
    if (last === from) return { logs, truncated: true };
    from = last;
  }
  return { logs, truncated: true };
}

// ─── The network's own RPC (keyless) ────────────────────────────────────────

/** JSON-RPC errors that mean "busy, ask again" rather than "no". */
const TRANSIENT = /temporar|unavailable|rate|too many|timeout|busy/i;

async function rpcLogs(url: string, filter: object, signal: AbortSignal): Promise<RawLog[]> {
  let body: any;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchPatiently(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ fromBlock: '0x0', toBlock: 'latest', ...filter }] }),
      },
      signal
    );
    const transient = res.status >= 500;
    body = res.ok ? await res.json().catch(() => null) : null;
    const message = body?.error ? String(body.error.message ?? body.error.code) : '';
    if ((transient || TRANSIENT.test(message)) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`RPC answered ${res.status}`);
    if (!body) throw new Error('RPC answer unreadable');
    if (body.error) throw new Error(`RPC: ${message.slice(0, 120)}`);
    break;
  }
  return (body.result ?? []).map((log: any) => ({
    address: log.address,
    topics: log.topics ?? [],
    data: log.data ?? '0x',
    block: toNumber(log.blockNumber) ?? 0,
    tx: log.transactionHash,
  }));
}

/** No keyless source for the network and no key: say what would unlock it. */
export class NeedsKeyError extends Error {
  constructor(chainName: string) {
    super(`${chainName} has no free history source — add a HyperSync key in settings`);
  }
}

export async function findCandidates(
  chain: EvmScanChain,
  owner: string,
  hypersyncKey: string | undefined,
  signal: AbortSignal
): Promise<EventScan> {
  const errors: string[] = [];
  const note = (label: string, err: any) => errors.push(`${label}: ${String(err?.message ?? err).slice(0, 120)}`);
  if (hypersyncKey) {
    try {
      const logs = await hypersyncLogs(chain.id, owner, hypersyncKey, signal);
      return { candidates: candidatesFrom(logs, chain.id), source: 'HyperSync' };
    } catch (err) {
      // A bad key or an outage: the keyless sources still give an answer where there are any.
      if (signal.aborted) throw err;
      note('HyperSync', err);
    }
  }
  if (!chain.events.length) {
    if (errors.length) throw new Error(errors.join('; '));
    throw new NeedsKeyError(chain.name);
  }
  for (const source of chain.events) {
    try {
      return await keylessCandidates(chain, source, owner, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      note(source.kind === 'rpc' ? new URL(source.url).hostname : source.host, err);
    }
  }
  throw new Error(errors.join('; '));
}

async function keylessCandidates(chain: EvmScanChain, source: EventSource, owner: string, signal: AbortSignal): Promise<EventScan> {
  const permit2 = permit2Address(chain.id);
  if (source.kind === 'blockscout') {
    // One after another: Blockscout's free limit is shared with the name lookups.
    const parts = [];
    for (const filter of [
      { topic0: TOPICS.approval },
      { topic0: TOPICS.approvalForAll },
      { topic0: TOPICS.permit2Approval, address: permit2 },
      { topic0: TOPICS.permit2Permit, address: permit2 },
    ]) {
      parts.push(await blockscoutLogs(source.host, filter, owner, signal));
    }
    const truncated = parts.some((p) => p.truncated);
    return {
      candidates: candidatesFrom(parts.flatMap((p) => p.logs), chain.id),
      source: 'Blockscout',
      note: truncated ? 'Very long history: the oldest approvals may be missing — a HyperSync key reads all of it.' : undefined,
    };
  }
  const [plain, viaPermit2] = await Promise.all([
    rpcLogs(source.url, { topics: [[TOPICS.approval, TOPICS.approvalForAll], ownerTopic(owner)] }, signal),
    rpcLogs(source.url, { address: permit2, topics: [[TOPICS.permit2Approval, TOPICS.permit2Permit], ownerTopic(owner)] }, signal),
  ]);
  return { candidates: candidatesFrom([...plain, ...viaPermit2], chain.id), source: `public RPC (${new URL(source.url).hostname})` };
}

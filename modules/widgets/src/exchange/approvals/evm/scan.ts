import { parseAbi, zeroAddress, type Address, type PublicClient } from 'viem';
import { fetchTokens } from '../../bestrate/catalog';
import { BrToken } from '../../bestrate/types';
import { EvmScanChain, readClient } from '../chains';
import { assessRisk, UNLIMITED, valueAtRisk } from '../risk';
import { describeSpenders, eachLimited } from '../spenders';
import { Approval, SpenderInfo } from '../types';
import { Candidate, findCandidates, permit2Address } from './events';

/**
 * One network's approvals as they stand today: the history gives the pairs,
 * the chain itself says which are still open, and what they could cost.
 */

const ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]);
const PERMIT2_ABI = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

type Call = { address: Address; abi: any; functionName: string; args?: readonly unknown[] };
type Result = { status: 'success'; result: any } | { status: 'failure'; error: Error };

const CHUNK = 150;

/** Multicall in chunks; calls that failed are tried again in small groups (one bad token can starve a big batch of gas). */
export async function multicall(client: PublicClient, calls: Call[], signal: AbortSignal): Promise<Result[]> {
  const run = async (list: Call[], size: number) => {
    const out: Result[] = [];
    for (let i = 0; i < list.length; i += size) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const part = (await client.multicall({
        contracts: list.slice(i, i + size) as any,
        allowFailure: true,
        batchSize: 64_000,
      })) as Result[];
      out.push(...part);
    }
    return out;
  };
  const results = await run(calls, CHUNK);
  const failed = results.map((r, i) => (r.status === 'failure' ? i : -1)).filter((i) => i >= 0);
  if (failed.length && failed.length < results.length) {
    const retried = await run(failed.map((i) => calls[i]), 10).catch(() => null);
    retried?.forEach((r, j) => {
      if (r.status === 'success') results[failed[j]] = r;
    });
  }
  return results;
}

interface Live {
  candidate: Candidate;
  amount?: bigint;
  expiration?: number;
}

/** Which candidates are still in force, and for how much. */
async function readLive(client: PublicClient, chainId: number, owner: Address, candidates: Candidate[], signal: AbortSignal): Promise<Live[]> {
  const permit2 = permit2Address(chainId) as Address;
  const calls: Call[] = [];
  const slots: number[][] = [];
  for (const c of candidates) {
    const token = c.token as Address;
    const spender = c.spender as Address;
    const at = calls.length;
    if (c.kind === 'token') {
      calls.push({ address: token, abi: ABI, functionName: 'allowance', args: [owner, spender] });
      slots.push([at]);
    } else if (c.kind === 'nft-token') {
      calls.push({ address: token, abi: ABI, functionName: 'getApproved', args: [c.tokenId!] });
      calls.push({ address: token, abi: ABI, functionName: 'ownerOf', args: [c.tokenId!] });
      slots.push([at, at + 1]);
    } else if (c.kind === 'nft-all') {
      calls.push({ address: token, abi: ABI, functionName: 'isApprovedForAll', args: [owner, spender] });
      slots.push([at]);
    } else {
      calls.push({ address: permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [owner, token, spender] });
      slots.push([at]);
    }
  }
  const results = await multicall(client, calls, signal);
  const nowS = Math.floor(Date.now() / 1000);
  const live: Live[] = [];
  candidates.forEach((c, i) => {
    const [first, second] = slots[i].map((j) => results[j]);
    if (first?.status !== 'success') return;
    if (c.kind === 'token') {
      const amount = first.result as bigint;
      if (amount > 0n) live.push({ candidate: c, amount });
    } else if (c.kind === 'nft-token') {
      const approved = String(first.result).toLowerCase();
      const holder = second?.status === 'success' ? String(second.result).toLowerCase() : '';
      if (approved === c.spender && approved !== zeroAddress && holder === owner.toLowerCase()) {
        live.push({ candidate: c, amount: 1n });
      }
    } else if (c.kind === 'nft-all') {
      if (first.result === true) live.push({ candidate: c });
    } else {
      const [amount, expiration] = first.result as [bigint, number];
      if (amount > 0n && Number(expiration) >= nowS) live.push({ candidate: c, amount, expiration: Number(expiration) });
    }
  });
  return live;
}

interface TokenMeta {
  symbol?: string;
  name?: string;
  decimals?: number;
  balance?: bigint;
}

async function readTokenMeta(client: PublicClient, owner: Address, tokens: string[], signal: AbortSignal): Promise<Map<string, TokenMeta>> {
  const calls: Call[] = tokens.flatMap((t) => [
    { address: t as Address, abi: ABI, functionName: 'symbol' },
    { address: t as Address, abi: ABI, functionName: 'name' },
    { address: t as Address, abi: ABI, functionName: 'decimals' },
    { address: t as Address, abi: ABI, functionName: 'balanceOf', args: [owner] },
  ]);
  const results = await multicall(client, calls, signal);
  const value = (r: Result | undefined) => (r?.status === 'success' ? r.result : undefined);
  return new Map(
    tokens.map((t, i) => {
      const [symbol, name, decimals, balance] = results.slice(i * 4, i * 4 + 4).map(value);
      return [
        t,
        {
          symbol: typeof symbol === 'string' ? symbol.slice(0, 24) : undefined,
          name: typeof name === 'string' ? name.slice(0, 60) : undefined,
          decimals: decimals != null ? Number(decimals) : undefined,
          balance: typeof balance === 'bigint' ? balance : undefined,
        },
      ];
    })
  );
}

async function readTimes(client: PublicClient, blocks: number[], signal: AbortSignal): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  // Enough for the dates of what is listed; the rest stays undated.
  await eachLimited(blocks.slice(0, 80), 4, async (n) => {
    if (signal.aborted) return;
    const block = await client.getBlock({ blockNumber: BigInt(n) }).catch(() => null);
    if (block) out.set(n, Number(block.timestamp));
  });
  return out;
}

export interface EvmChainResult {
  approvals: Approval[];
  source: string;
  note?: string;
}

export async function scanEvmChain(
  chain: EvmScanChain,
  owner: Address,
  hypersyncKey: string | undefined,
  signal: AbortSignal
): Promise<EvmChainResult> {
  const found = await findCandidates(chain, owner, hypersyncKey, signal);
  const client = readClient(chain.id);
  const live = await readLive(client, chain.id, owner, found.candidates, signal);
  if (!live.length) return { approvals: [], source: found.source, note: found.note };

  const tokens = [...new Set(live.map((l) => l.candidate.token))];
  const spenders = [...new Set(live.map((l) => l.candidate.spender))];
  const [meta, listed, codes] = await Promise.all([
    readTokenMeta(client, owner, tokens, signal),
    fetchTokens(chain.id).catch(() => [] as BrToken[]),
    (async () => {
      const codes = new Map<string, `0x${string}` | undefined>();
      await eachLimited(spenders, 6, async (s) => {
        codes.set(s, await client.getCode({ address: s as Address }).catch(() => undefined));
      });
      return codes;
    })(),
  ]);
  const infos = await describeSpenders(chain, codes, signal);
  const undated = [...new Set(live.filter((l) => l.candidate.time == null).map((l) => l.candidate.block))];
  const times = undated.length ? await readTimes(client, undated, signal) : new Map<number, number>();
  const byAddress = new Map(listed.map((t) => [t.address.toLowerCase(), t]));

  const approvals = live.map(({ candidate: c, amount, expiration }) => {
    const m = meta.get(c.token) ?? {};
    const lifi = byAddress.get(c.token);
    const nft = c.kind === 'nft-all' || c.kind === 'nft-token';
    const spenderInfo: SpenderInfo = infos.get(c.spender) ?? { type: 'unknown' };
    const decimals = nft ? undefined : (lifi?.decimals ?? m.decimals);
    const draft = {
      id: `EVM:${chain.id}:${c.kind}:${c.token}:${c.spender}:${c.tokenId ?? ''}`,
      family: 'EVM' as const,
      chainId: chain.id,
      chainName: chain.name,
      kind: c.kind,
      token: c.token,
      symbol: lifi?.symbol ?? m.symbol ?? `${c.token.slice(0, 6)}…${c.token.slice(-4)}`,
      tokenName: lifi?.name ?? m.name,
      decimals,
      logo: lifi?.logo,
      listed: !!lifi && lifi.status === 'verified',
      spender: c.spender,
      spenderInfo,
      amount,
      unlimited: amount != null && amount >= UNLIMITED,
      expiration,
      tokenId: c.tokenId,
      balance: m.balance,
      priceUSD: lifi?.priceUSD || undefined,
      lastChange: c.time ?? times.get(c.block),
      lastBlock: c.block,
      lastTx: c.tx,
      atRiskUSD: undefined as number | undefined,
    };
    draft.atRiskUSD = valueAtRisk(draft);
    return { ...draft, ...assessRisk(draft) } satisfies Approval;
  });
  return { approvals, source: found.source, note: found.note };
}

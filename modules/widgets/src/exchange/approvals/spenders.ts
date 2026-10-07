import { allowedContracts } from '../bestrate/execute/contracts';
import { ProviderId } from '../bestrate/types';
import {
  ENSO_ROUTERS,
  YBOLD_STAKING_ADDRESS,
  YBOLD_VAULT_ADDRESS,
  YBOLD_ZAPPER_ADDRESS,
  YEARN_4626_ROUTER,
  YVUSD_LOCKED_ADDRESS,
  YVUSD_UNLOCKED_ADDRESS,
  YVUSD_ZAP_ADDRESS,
} from '../../earn/constants';
import { EvmScanChain } from './chains';
import { permit2Address } from './evm/events';
import { SpenderInfo } from './types';

/**
 * Names for spenders, and which ones are well-known protocols. A contract
 * sits at the same address on every chain only when its own team deployed
 * it there, so an address match counts on any network.
 */
const KNOWN: Record<string, string> = {
  '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Uniswap Permit2',
  '0x0000000000225e31d15943971f47ad3022f714fa': 'Uniswap Permit2',
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2 Router',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 Router',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap V3 Router 2',
  '0x2626664c2603336e57b271c5c0b26f421741e481': 'Uniswap V3 Router 2',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Uniswap Universal Router',
  '0x66a9893cc07d91d95644aedd05d03f95e1dba8af': 'Uniswap Universal Router (v4)',
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch Router v5',
  '0x111111125421ca6dc452d289314280a0f8842a65': '1inch Router v6',
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x Exchange Proxy',
  '0x0000000000001ff3684f28c67538d4d072c22734': '0x AllowanceHolder',
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': 'ParaSwap v5',
  '0x6a000f20005980200259b80c5102003040001068': 'ParaSwap v6',
  '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110': 'CoW Protocol',
  '0xba12222222228d8ba445958a75a0704d566bf2c8': 'Balancer Vault',
  '0x1e0049783f008a0085193e00003d00cd54003c71': 'OpenSea',
  // Earn (Yearn) contracts CoinMan itself approves for.
  [YEARN_4626_ROUTER.toLowerCase()]: 'Yearn router',
  [YVUSD_ZAP_ADDRESS.toLowerCase()]: 'Yearn yvUSD zap',
  [YVUSD_UNLOCKED_ADDRESS.toLowerCase()]: 'Yearn yvUSD vault',
  [YVUSD_LOCKED_ADDRESS.toLowerCase()]: 'Yearn yvUSD vault (locked)',
  [YBOLD_ZAPPER_ADDRESS.toLowerCase()]: 'Yearn yBOLD zapper',
  [YBOLD_VAULT_ADDRESS.toLowerCase()]: 'Yearn yBOLD vault',
  [YBOLD_STAKING_ADDRESS.toLowerCase()]: 'Yearn st-yBOLD',
  ...Object.fromEntries(Object.values(ENSO_ROUTERS).map((a) => [a.toLowerCase(), 'Enso router (Yearn zaps)'])),
};

/** Best Rate's services, from its own allow-list. */
const SERVICE_NAMES: [ProviderId, string][] = [
  ['relay', 'Relay'],
  ['socket', 'Socket (Bungee)'],
  ['kyberswap', 'KyberSwap'],
  ['debridge', 'deBridge'],
  ['lifi', 'LI.FI'],
];

export function knownName(chainId: number, address: string): string | undefined {
  const a = address.toLowerCase();
  if (a === permit2Address(chainId)) return 'Uniswap Permit2';
  for (const [provider, name] of SERVICE_NAMES) {
    if (allowedContracts(provider, chainId).has(a)) return name;
  }
  return KNOWN[a];
}

type Code = `0x${string}` | undefined;

/** An EIP-7702 account: an ordinary key that has borrowed contract code. */
const isDelegatedAccount = (code: Code) => !!code && code.toLowerCase().startsWith('0xef0100');

const cache = new Map<string, Promise<Partial<SpenderInfo>>>();

async function fetchJson(url: string, signal: AbortSignal): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(12_000);
    const res = await fetch(url, { signal: AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal });
    // Free explorers throttle bursts; a short wait is enough.
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
  }
}

/** Name, published source and scam flag of a contract, from Blockscout or else Sourcify. */
function lookupContract(chain: EvmScanChain, address: string, signal: AbortSignal): Promise<Partial<SpenderInfo>> {
  const key = `${chain.id}:${address}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      if (chain.blockscout) {
        try {
          const { status, body } = await fetchJson(`https://${chain.blockscout}/api/v2/addresses/${address}`, signal);
          if (status === 200 && body) {
            const tag = (body.metadata?.tags ?? []).find((t: any) => t?.tagType === 'name')?.name;
            // A proxy's own name (ERC1967Proxy…) says nothing; the contract behind it does.
            const behind = body.proxy_type ? body.implementations?.[0]?.name : undefined;
            return {
              name: tag || behind || body.name || undefined,
              verified: !!body.is_verified,
              scam: !!body.is_scam || body.reputation === 'scam',
            };
          }
        } catch {
          // Try Sourcify.
        }
      }
      try {
        const { status, body } = await fetchJson(
          `https://sourcify.dev/server/v2/contract/${chain.id}/${address}?fields=compilation`,
          signal
        );
        if (status === 200 && body) return { name: body.compilation?.name || undefined, verified: true };
      } catch {
        // Unknown either way.
      }
      // Not on Sourcify does not mean unpublished (Etherscan may have it): say nothing.
      return { verified: null };
    })();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

/** Runs `task` over `items`, `limit` at a time. */
export async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

/** Who each spender is, given its code on the chain. */
export async function describeSpenders(
  chain: EvmScanChain,
  codes: Map<string, Code>,
  signal: AbortSignal
): Promise<Map<string, SpenderInfo>> {
  const out = new Map<string, SpenderInfo>();
  await eachLimited([...codes.keys()], 4, async (address) => {
    const code = codes.get(address);
    const known = knownName(chain.id, address);
    if (!code || code === '0x' || isDelegatedAccount(code)) {
      out.set(address, {
        type: 'account',
        name: isDelegatedAccount(code) ? 'Account with borrowed code (EIP-7702)' : undefined,
      });
      return;
    }
    if (known) {
      out.set(address, { type: 'contract', name: known, known: true, verified: true });
      return;
    }
    const found = await lookupContract(chain, address, signal).catch(() => ({ verified: null }));
    out.set(address, { type: 'contract', ...found });
  });
  return out;
}

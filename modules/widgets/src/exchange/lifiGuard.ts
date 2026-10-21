import { createClient, custom, type Client } from 'viem';
import { diag } from '../diag';

/**
 * Last check before the LI.FI widget reaches a wallet.
 *
 * Routes and their transactions come from the li.quest API. Every route LI.FI
 * builds goes through its Diamond contract, so a transaction may only call the
 * Diamond of its chain or approve a token for it. Anything else — a call to
 * another contract, a message or permit to sign — is refused here, before the
 * wallet shows it. The EVM provider also runs with message signing off, so
 * permits and relayed orders are not even requested.
 *
 * jumper.xyz cannot be told to skip permits, so its calls may also take
 * LI.FI's Permit2 path: approve the token for Permit2, sign a transfer permit
 * whose only spender is LI.FI's Permit2Proxy (or an EIP-2612 permit for it),
 * then call the proxy, which can only pass the call on to the Diamond.
 */

/** LI.FI Diamond per chain, from li.quest/v1/chains (2026-09-29). */
const DIAMOND_CHAINS: Record<string, number[]> = {
  '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE': [
    1, 42161, 8453, 56, 10, 137, 43114, 100, 1135, 122, 1329, 13371, 146, 1625, 196, 204, 25,
    252, 288, 30, 34443, 42220, 480, 5000, 534352, 81457,
  ],
  '0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37': [143, 43111, 4326, 747, 9745, 988],
  '0x864b314D4C5a0399368609581d3E8933a63b9232': [130, 1868, 57073],
  '0x198FC70Dfe05E755C81e54bd67Bff3F729344B9b': [14, 1480, 88],
  '0xFf70F4A1d11995621854F3692acF286d8aCd04b2': [1672, 42170],
  '0x452Cf1B8597E6319Cd21abd847312bF17E26d8d1': [2020, 60808],
  '0xB477751B76CF82d00a686A1232f5fCD772414Af3': [4663],
  '0x0a0758d937d1059c356D4714e57F5df0239bce1A': [999],
  '0x24ca98fB6972F5eE05f0dB00595c7f68D9FaFd68': [1088],
  '0x213A83c67E1Fc0334eF684571ABCB820708A6536': [16661],
  '0xeCeC3970Ca674278DA8D9B1c484ACaF6B20181F5': [1776],
  '0xF3B20515d9B193531c48E47c18aF16d1e5d28f9a': [232],
  '0x4f8C9056bb8A3616693a76922FA35d53C056E5b3': [2741],
  '0xF7aB42D00D2399f8A4Fba2F15466Be40709fe307': [2818],
  '0x341e94069f53234fe6dabef707ad424830525715': [324],
  '0x2dea447e7dc6cd2f10b31bF10dCB30F87E838417': [33139],
  '0xa7cd44521903C65915648385E3FE881E49171582': [40],
  '0x2cAcAE8e22418E65dcf7651c67aEbe6288EB8243': [4217],
  '0x977474593c982cFa8b197cAE302e6d01f789435b': [42793],
  '0x055d4612Ec74aD799C6cB4dF72C0Ab8dbDBCBAfa': [50],
  '0x0bc413CAe89C5b3Ba3AA87FB98dCA23425E1828f': [5031],
  '0xA4072583658Fae592A3506A42431cb6316a8d40b': [5042],
  '0xde1e598b81620773454588b85d6b5d4eec32573e': [59144],
  '0xC59fe32C9549e3E8B5dCcdAbC45BD287Bd5bA2bc': [747474],
  '0xf909c4Ae16622898b885B89d7F839E0244851c66': [80094],
  '0x1255d17c1bc2f764d087536410879f2d0d8772fd': [8217],
  '0x6f5C8Bb0C5Fe4ECeAC40EE1C238EaB6bbb29761c': [98866],
};

/** `{ address: chains }` turned into chain → lowercase address. */
const byChain = (table: Record<string, number[]>) =>
  new Map<number, string>(
    Object.entries(table).flatMap(([address, chains]) =>
      chains.map((chainId) => [chainId, address.toLowerCase()] as [number, string])
    )
  );

const EVM_DIAMONDS = byChain(DIAMOND_CHAINS);

/** LI.FI Diamond on an EVM chain, lowercase; undefined where LI.FI has none. */
export const lifiDiamond = (chainId: number): string | undefined => EVM_DIAMONDS.get(chainId);

/** LI.FI Diamond on Tron, base58 and the hex form Tron transactions carry. */
const TRON_DIAMOND = {
  base58: 'TU3ymitEKCWQFtASkEeHaPb8NfZcJtCHLt',
  hex: '41c6594cd50c39ba5f23538fdc3b8492c95edb6fe1',
};

/** Permit2 per chain where LI.FI runs a Permit2Proxy, from li.quest/v1/chains (2026-10-21). */
const PERMIT2_CHAINS: Record<string, number[]> = {
  '0x000000000022D473030F116dDEE9F6B43aC78BA3': [
    1, 42161, 4663, 8453, 999, 143, 56, 10, 137, 43114, 100, 1088, 1135, 122, 130, 1329, 13371,
    146, 1480, 1625, 16661, 1672, 1776, 1868, 196, 2020, 25, 252, 2818, 30, 33139, 34443, 40, 4217,
    42170, 42220, 42793, 43111, 4326, 480, 5000, 5031, 5042, 534352, 57073, 59144, 747, 747474,
    80094, 8217, 88, 9745, 988, 98866,
  ],
  '0x08208a5f56696E7AA3eAF7a307fa63B37bd8e8A5': [14],
  '0x0000000000225e31D15943971F47aD3022F714Fa': [2741, 324],
  '0xB952578f3520EE8Ea45b7914994dcf4702cEe578': [50],
};

/** LI.FI Permit2Proxy per chain, from li.quest/v1/chains (2026-10-21). */
const PERMIT2_PROXY_CHAINS: Record<string, number[]> = {
  '0x89c6340B1a1f4b25D36cd8B063D49045caF3f818': [
    1, 42161, 8453, 56, 10, 137, 43114, 100, 1135, 122, 1329, 13371, 146, 1625, 196, 25, 252, 30,
    33139, 34443, 42220, 480, 534352,
  ],
  '0x8eABB4E117fB70b346592e013855f6d825F50af1': [4663],
  '0x3e851976DCA1bc02A2F35Ce926dCAFD1dEB3359b': [999],
  '0x3c6B2E0b7421254846C53c118e24c65d59eAe75e': [143, 43111, 747, 9745],
  '0x82D7dD86603A6344b82a3914Fe02fEF7b6CDe2E2': [1088],
  '0x1BCd304fDAd1d1D66529159b1Bc8D13C9158D586': [130, 1868, 57073],
  '0xac08C219Fd4856A33a090503BCbc14733d588588': [14, 88],
  '0x32cae53E5476d3B9dB0223A47dCF41ABbDf52bDb': [1480],
  '0x3e289E1afc7E6f29cBafb8a8C8e4fa2Df846072C': [16661],
  '0x36C800D4472fBb888D034Aa74778f481aEE01FEc': [1672, 42170],
  '0x263c63c1D8901c14520474110CE88CfADae0CfE9': [1776],
  '0xfeD71074954d4cb8f1D2A8ca317d72c75e3E0559': [2020],
  '0xbb7c30Dc5AcE1A51940b202182c07D45e3e2Cba4': [2741],
  '0xAC0baB151c21A430145184Dd9124f9480c03717c': [2818],
  '0x2ec2c4C3dc212C990d1bc2b48b0392A3951D926E': [324],
  '0xF59bE2B25A183951BDE57D4ADdBb2f38A8A95f4D': [40],
  '0xa69d78858B27235575D7EfE240be91744a68E005': [4217],
  '0x799356A518cFe5BDf874A593dF41cA2A5e1575b7': [42793],
  '0x700f1874314A4dF3bb9A10f7B5eA187A39d8dE74': [4326, 988],
  '0x767cEE938DF7d88D3e880Cbfc35C9cAfee882f4d': [50],
  '0xBDfF0c1C8B0b779581C4aC3bA1F29667C366C56e': [5000],
  '0x5b11025E373e5c238eF4a98f81e935259AaF79f3': [5031],
  '0x9048Ab4E896aF38E2C3d001Aa1D7FB7668739e1d': [5042],
  '0xE5A89411c7Ef1502123d84ec1F9Da9D8574F4293': [59144],
  '0x628d684D57c73A5D8cA77F455Fdf2CC8Bd503c16': [747474],
  '0x66C8F3F645Bc61ed1740067D381830f7c7925d98': [80094],
  '0x56E3B9Cf704991cc554902b16610255568A58B12': [8217],
  '0x9C1D1db1CD3EbE4727c2a4208Ca5D65624cC9b4D': [98866],
};

const PERMIT2 =byChain(PERMIT2_CHAINS);
const PERMIT2_PROXIES = byChain(PERMIT2_PROXY_CHAINS);

/** The Permit2Proxy calls that hand a permit and calldata on to the Diamond. */
const PROXY_SELECTORS = new Set([
  '0193b9fc', // callDiamondWithPermit2(bytes,((address,uint256),uint256,uint256),bytes)
  '4561136e', // callDiamondWithPermit2Witness(bytes,address,((address,uint256),uint256,uint256),bytes)
  'd7a08473', // callDiamondWithEIP2612Signature(address,uint256,uint256,uint8,bytes32,bytes32,bytes)
]);

/** A permit may stay valid this long; LI.FI asks for 30 minutes. */
const MAX_PERMIT_SECONDS = 2 * 60 * 60;

/** `approve(address,uint256)` */
const APPROVE_SELECTOR = '095ea7b3';

/** Wallet methods that sign something other than a checked transaction. */
const SIGNING_METHODS = new Set([
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'eth_signTransaction',
  'eth_sendRawTransaction',
  'wallet_grantPermissions',
]);

type BlockListener = (reason: string) => void;
const listeners = new Set<BlockListener>();

/** Called with the reason whenever the guard refuses a wallet request. */
export function onGuardBlock(listener: BlockListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function block(reason: string): never {
  diag('error', 'LIFI', `blocked: ${reason}`);
  listeners.forEach((listener) => listener(reason));
  throw new Error(`Blocked by CoinMan safety check: ${reason}`);
}

/** Spender and amount of an `approve(address,uint256)` call, from bare hex data. */
function decodeApprove(hexData: string): { spender: string; amount: bigint } | null {
  const data = hexData.toLowerCase().replace(/^0x/, '');
  if (!data.startsWith(APPROVE_SELECTOR) || data.length < 136) return null;
  return { spender: data.slice(32, 72), amount: BigInt(`0x${data.slice(72, 136)}`) };
}

const hasValue = (value: unknown) => value != null && BigInt(value as string | number) > 0n;

interface EvmCall {
  to?: string;
  data?: string;
  value?: string | number;
}

export function checkEvmCall(chainId: number, call: EvmCall): void {
  const diamond = EVM_DIAMONDS.get(chainId);
  if (!diamond) block(`LI.FI has no known contract on chain ${chainId}`);
  const to = call.to?.toLowerCase();
  if (to === diamond) return;
  const selector = (call.data ?? '').toLowerCase().replace(/^0x/, '').slice(0, 8);
  // The proxy only ever forwards to the Diamond, and only through these calls.
  if (to && to === PERMIT2_PROXIES.get(chainId) && PROXY_SELECTORS.has(selector)) return;
  const approve = call.data ? decodeApprove(call.data) : null;
  // Setting an allowance to 0 is harmless whoever the spender is (USDT resets).
  // Permit2 moves nothing without a signed permit, and those are checked below.
  const spender = approve && `0x${approve.spender}`;
  if (
    approve &&
    !hasValue(call.value) &&
    (approve.amount === 0n || spender === diamond || spender === PERMIT2.get(chainId))
  ) {
    return;
  }
  block(
    approve
      ? `chain ${chainId}: approval for ${spender} is not for the LI.FI contract`
      : `chain ${chainId}: call to ${call.to ?? 'nowhere'} is not the LI.FI contract`
  );
}

const sameAddress = (a: unknown, b: string | undefined) =>
  typeof a === 'string' && !!b && a.toLowerCase() === b.toLowerCase();

/** Field names of `types[name]`, in order, joined with commas. */
const fieldsOf = (types: any, name: string) =>
  Array.isArray(types?.[name]) ? types[name].map((f: any) => `${f?.name} ${f?.type}`).join(',') : '';

const PERMIT2_FIELDS = 'permitted TokenPermissions,spender address,nonce uint256,deadline uint256';
const EIP2612_FIELDS = 'owner address,spender address,value uint256,nonce uint256,deadline uint256';

/**
 * Lets the wallet sign `typedData` for `account` on `chainId` only if it is one
 * of LI.FI's permits: a Permit2 transfer (with or without the LiFiCall
 * witness) or an EIP-2612 permit, spendable by LI.FI's Permit2Proxy alone and
 * for at most two hours. Anything else — orders, Permit2 allowances,
 * DAI-style unlimited permits, log-ins — is refused.
 */
export function checkPermitSignature(chainId: number, account: string, typedData: unknown): void {
  let data: any = typedData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      block('the message to sign is not valid typed data');
    }
  }
  const proxy = PERMIT2_PROXIES.get(chainId);
  if (!proxy) block(`LI.FI has no permit contract on chain ${chainId}`);
  const { domain, types, message, primaryType } = data ?? {};
  // A few tokens (USDC and DAI on Polygon) carry the chain as the domain's salt.
  const domainChainRaw = domain?.chainId ?? (primaryType === 'Permit' ? domain?.salt : undefined);
  let domainChain: number | undefined;
  try {
    domainChain = domainChainRaw == null ? undefined : Number(BigInt(domainChainRaw));
  } catch {
    domainChain = undefined;
  }
  if (domainChain !== chainId) block(`permit for chain ${domainChainRaw ?? 'none'}, wallet is on ${chainId}`);
  if (!sameAddress(message?.spender, proxy)) {
    block(`permit for ${message?.spender ?? 'nobody'} is not for the LI.FI contract`);
  }
  let deadline: bigint;
  try {
    deadline = BigInt(message?.deadline);
  } catch {
    block('permit without a deadline');
  }
  if (deadline > BigInt(Math.floor(Date.now() / 1000) + MAX_PERMIT_SECONDS)) {
    block('permit stays valid for too long');
  }

  if (primaryType === 'Permit') {
    if (fieldsOf(types, 'Permit') !== EIP2612_FIELDS) block('not an EIP-2612 permit');
    if (!sameAddress(message.owner, account)) block('permit is not from the connected wallet');
    return;
  }
  if (domain?.name !== 'Permit2' || !sameAddress(domain.verifyingContract, PERMIT2.get(chainId))) {
    block(`signature for ${domain?.name ?? 'an unknown contract'} is not a LI.FI permit`);
  }
  if (primaryType === 'PermitTransferFrom' && fieldsOf(types, primaryType) === PERMIT2_FIELDS) return;
  if (
    primaryType === 'PermitWitnessTransferFrom' &&
    fieldsOf(types, primaryType) === `${PERMIT2_FIELDS},witness LiFiCall` &&
    sameAddress(message.witness?.diamondAddress, EVM_DIAMONDS.get(chainId))
  ) {
    return;
  }
  block(`Permit2 ${primaryType ?? 'message'} is not a LI.FI transfer permit`);
}

type Forward = (args: { method: string; params?: unknown }) => Promise<unknown>;

async function checkEvmRequest(method: string, params: unknown, forward: Forward): Promise<void> {
  if (SIGNING_METHODS.has(method)) block(`the wallet was asked to sign a message (${method})`);
  if (method === 'eth_sendTransaction') {
    const [tx] = params as [EvmCall & { chainId?: string }];
    const chainId = Number(tx?.chainId ?? (await forward({ method: 'eth_chainId' })));
    checkEvmCall(chainId, tx ?? {});
  } else if (method === 'wallet_sendCalls') {
    const [batch] = params as [{ chainId?: string; calls?: EvmCall[] }];
    const chainId = Number(batch?.chainId ?? (await forward({ method: 'eth_chainId' })));
    if (!batch?.calls?.length) block('empty transaction batch');
    batch.calls.forEach((call) => checkEvmCall(chainId, call));
  }
}

/** The wallet client the widget signs with, with every request checked first. */
export function guardEvmClient(client: Client): Client {
  const forward = client.request as unknown as Forward;
  return createClient({
    account: client.account,
    chain: client.chain,
    name: 'LI.FI guarded wallet',
    transport: custom(
      {
        async request({ method, params }) {
          await checkEvmRequest(method, params, forward);
          return forward({ method, params });
        },
      },
      { retryCount: 0 }
    ),
  });
}

const isTronDiamond = (address: unknown) =>
  typeof address === 'string' &&
  (address.startsWith('T')
    ? address === TRON_DIAMOND.base58
    : address.toLowerCase().replace(/^0x/, '') === TRON_DIAMOND.hex);

export function checkTronTransaction(transaction: any): void {
  const contracts = transaction?.raw_data?.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1) block('unexpected Tron transaction');
  const [contract] = contracts;
  if (contract?.type !== 'TriggerSmartContract') {
    block(`Tron ${contract?.type ?? 'unknown'} transaction`);
  }
  const value = contract.parameter?.value ?? {};
  if (isTronDiamond(value.contract_address)) return;
  const approve = typeof value.data === 'string' ? decodeApprove(value.data) : null;
  if (
    approve &&
    !hasValue(value.call_value) &&
    (approve.amount === 0n || `41${approve.spender}` === TRON_DIAMOND.hex)
  ) {
    return;
  }
  block(
    approve
      ? `Tron: approval for 41${approve.spender} is not for the LI.FI contract`
      : `Tron: call to ${value.contract_address ?? 'nowhere'} is not the LI.FI contract`
  );
}

/** The Tron wallet adapter the widget signs with, with every transaction checked first. */
export function guardTronWallet<W extends object>(wallet: W): W {
  return new Proxy(wallet, {
    get(target, prop) {
      if (prop === 'signTransaction') {
        return async (transaction: unknown, ...rest: unknown[]) => {
          checkTronTransaction(transaction);
          return (target as any).signTransaction(transaction, ...rest);
        };
      }
      if (prop === 'signMessage' || prop === 'multiSign') {
        return async () => block('the Tron wallet was asked to sign a message');
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

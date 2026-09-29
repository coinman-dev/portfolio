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

const EVM_DIAMONDS = new Map<number, string>(
  Object.entries(DIAMOND_CHAINS).flatMap(([address, chains]) =>
    chains.map((chainId) => [chainId, address.toLowerCase()] as [number, string])
  )
);

/** LI.FI Diamond on Tron, base58 and the hex form Tron transactions carry. */
const TRON_DIAMOND = {
  base58: 'TU3ymitEKCWQFtASkEeHaPb8NfZcJtCHLt',
  hex: '41c6594cd50c39ba5f23538fdc3b8492c95edb6fe1',
};

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
  if (call.to?.toLowerCase() === diamond) return;
  const approve = call.data ? decodeApprove(call.data) : null;
  // Setting an allowance to 0 is harmless whoever the spender is (USDT resets).
  if (approve && !hasValue(call.value) && (approve.amount === 0n || `0x${approve.spender}` === diamond)) {
    return;
  }
  block(
    approve
      ? `chain ${chainId}: approval for 0x${approve.spender} is not for the LI.FI contract`
      : `chain ${chainId}: call to ${call.to ?? 'nowhere'} is not the LI.FI contract`
  );
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

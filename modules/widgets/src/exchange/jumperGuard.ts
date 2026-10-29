import { encodeFunctionData, parseAbi } from 'viem';
import {
  block,
  checkEvmCall,
  checkPermitSignature,
  decodeApprove,
  fieldsOf,
  hasValue,
  lifiDiamond,
  lifiPermit2,
  lifiPermit2Proxy,
  sameAddress,
} from './lifiGuard';

/**
 * Safety check for jumper.xyz, on top of the LI.FI one.
 *
 * Jumper's backend adds its own routes to LI.FI's: Uniswap, CoW Swap, Velora
 * Delta and FYND (Tycho). Their contracts are whitelisted here, each address
 * confirmed in the protocol's own deployment list; docs/jumper-whitelist.md
 * names the sources so the list can be checked again. Anything else — LI.FI
 * Composer included, whose factory is not in LI.FI's published deployments —
 * is refused.
 *
 * Approvals and signed amounts are held to the swap: an approval larger than
 * the amount of the route the site fetched is cut down to it, and a permit or
 * order for more than that is refused. The amounts come from the page script,
 * which reads the site's own route responses (`AmountHints`).
 */

/** Swap amounts per `${chainId}:${token}` (lowercase), in the token's base units. */
export type AmountHints = Record<string, string>;

/** Chains → address tables, as in lifiGuard. */
const byChain = (table: Record<string, number[]>) =>
  new Map<number, string>(
    Object.entries(table).flatMap(([address, chains]) =>
      chains.map((chainId) => [chainId, address.toLowerCase()] as [number, string])
    )
  );

/** Uniswap UniversalRouter V2.1.2 (zkSync: UniversalRouter), from Uniswap/universal-router deploy-addresses. */
const UNISWAP_ROUTERS = byChain({
  '0x23617e59A5925b2A4Bf75d73ff6711cD0b29De85': [1],
  '0xC09255D86DB563cBc11C2fCf4a0C512e160111B4': [10],
  '0xDc264714F68d84CF29BC605589405E78bDBE7C9f': [56, 137, 59144],
  '0xD1b797D92d87B688193A2B976eFc8D577D204343': [130],
  '0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40': [8453],
  '0x2d01411773c8C24805306E89A41F7855C3c4Fe65': [42161],
  '0x661E93cca42AfacB172121EF892830cA3b70F08d': [43114],
  '0x28731BCC616B5f51dD52CF2e4dF0E78dD1136C06': [324],
});

/** FYND's Tycho router, from propeller-heads/tycho router_addresses.json. */
const TYCHO_ROUTERS = byChain({
  '0x1644D2477f809cc2C71bCCFd6Dc9497E3F83210d': [1],
  '0x7f3D12BBaFb8955E51B3ab9588b34c8ad95BDA4e': [56],
  '0xCba5574597Ad00EA250Fd106DAB4Fc7461949635': [130],
  '0xbd4e6011F03355C2A377Fd9Af939322A7d0A1bC1': [137],
  '0xAbA5B53b03eAfaD1C5fc8BD5Fc765fC85Bb3de67': [8453],
  '0x924F147c50eA59f5180a26031A8b65B2aA1e81Cd': [42161],
});

/** CoW Protocol, from cowprotocol/contracts networks.json and cow-sdk (EthFlow). */
const COW_CHAINS = [1, 10, 56, 100, 137, 8453, 42161, 43114];
const COW = {
  settlement: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
  vaultRelayer: '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110',
  ethFlow: '0xba3cb449bd2b4adddbc894d8697f5170800eadec',
};

/** Velora Delta (Portikus adapter), from api.velora.xyz/adapters/contracts (`ParaswapDelta`). */
const VELORA_CHAINS = [1, 10, 56, 130, 137, 8453, 42161];
const VELORA_DELTA = '0x0000000000bbf5c5fd284e657f01bd000933c96d';

const cowOn = (chainId: number) => COW_CHAINS.includes(chainId);
const veloraOn = (chainId: number) => VELORA_CHAINS.includes(chainId);

/** Who may be given an allowance on `chainId`, by name. */
function spenders(chainId: number): Map<string, string> {
  const out = new Map<string, string>();
  const add = (address: string | undefined, name: string) => address && out.set(address, name);
  add(lifiDiamond(chainId), 'LI.FI Diamond');
  add(lifiPermit2(chainId), 'Permit2');
  add(TYCHO_ROUTERS.get(chainId), 'FYND router');
  if (cowOn(chainId)) add(COW.vaultRelayer, 'CoW Protocol');
  if (veloraOn(chainId)) add(VELORA_DELTA, 'Velora Delta');
  return out;
}

/** Contracts outside LI.FI that Jumper's own routes call on `chainId`. */
function targets(chainId: number): Map<string, string> {
  const out = new Map<string, string>();
  const add = (address: string | undefined, name: string) => address && out.set(address, name);
  add(UNISWAP_ROUTERS.get(chainId), 'Uniswap router');
  add(TYCHO_ROUTERS.get(chainId), 'FYND router');
  if (cowOn(chainId)) add(COW.ethFlow, 'CoW Protocol');
  if (veloraOn(chainId)) add(VELORA_DELTA, 'Velora Delta');
  return out;
}

/** Orders may stay open this long; CoW and Velora give about 30 minutes. */
const MAX_ORDER_SECONDS = 24 * 60 * 60;
/** Permits may stay valid this long; Jumper asks for 30 minutes. */
const MAX_PERMIT_SECONDS = 2 * 60 * 60;

const now = () => BigInt(Math.floor(Date.now() / 1000));

function toBig(value: unknown, what: string): bigint {
  try {
    return BigInt(value as string | number);
  } catch {
    block(`${what} is missing or not a number`);
  }
}

function notAfter(value: unknown, seconds: number, what: string): void {
  if (toBig(value, what) > now() + BigInt(seconds)) block(`${what} is too far in the future`);
}

/** The swap amount the site's routes asked for, or a refusal if there is none. */
function swapAmount(chainId: number, token: unknown, hints: AmountHints | undefined): bigint {
  const key = `${chainId}:${String(token ?? '').toLowerCase()}`;
  const hint = hints?.[key];
  if (hint == null) {
    const known = Object.keys(hints ?? {}).join(', ') || 'none';
    block(`CoinMan does not know the swap amount for token ${token} on chain ${chainId} (known: ${known}) — refresh the quote`);
  }
  return toBig(hint, 'swap amount');
}

function withinSwap(chainId: number, token: unknown, amount: bigint, hints: AmountHints | undefined): void {
  const limit = swapAmount(chainId, token, hints);
  if (amount > limit) block(`asks for ${amount} of ${token}, more than the swap amount ${limit}`);
}

const APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export interface CheckedTransaction {
  /** Replacement calldata, when an approval was cut down to the swap amount. */
  data?: string;
  /** What the transaction is, for the log. */
  label: string;
}

/**
 * Lets `tx` through if it calls a whitelisted contract or approves a
 * whitelisted spender; an approval above the swap amount gets new calldata
 * for exactly that amount.
 */
export function checkJumperTransaction(
  chainId: number,
  tx: { to?: string; data?: string; value?: string | number },
  hints: AmountHints | undefined
): CheckedTransaction {
  const to = tx.to?.toLowerCase();
  const approve = tx.data ? decodeApprove(tx.data) : null;
  if (approve) {
    const spender = `0x${approve.spender}`;
    const name = spenders(chainId).get(spender);
    if (!name) block(`chain ${chainId}: approval for ${spender} is not for a whitelisted contract`);
    if (hasValue(tx.value)) block('an approval that also sends coins');
    if (approve.amount === 0n) return { label: `reset of the ${name} allowance` };
    const limit = swapAmount(chainId, to, hints);
    if (approve.amount <= limit) return { label: `approval for ${name}` };
    return {
      data: encodeFunctionData({ abi: APPROVE_ABI, functionName: 'approve', args: [spender as `0x${string}`, limit] }),
      label: `approval for ${name}, cut from ${approve.amount} to the swap amount ${limit}`,
    };
  }
  const name = to && targets(chainId).get(to);
  if (name) return { label: `call to ${name}` };
  if (to && (to === lifiDiamond(chainId) || to === lifiPermit2Proxy(chainId))) {
    checkEvmCall(chainId, tx);
    return { label: 'call to LI.FI' };
  }
  block(`chain ${chainId}: call to ${tx.to ?? 'nowhere'} is not a whitelisted contract`);
}

const PERMIT2_SINGLE_FIELDS = 'details PermitDetails,spender address,sigDeadline uint256';
const PERMIT_DETAILS_FIELDS = 'token address,amount uint160,expiration uint48,nonce uint48';
const EIP2612_FIELDS = 'owner address,spender address,value uint256,nonce uint256,deadline uint256';
const COW_ORDER_FIELDS =
  'sellToken address,buyToken address,receiver address,sellAmount uint256,buyAmount uint256,' +
  'validTo uint32,appData bytes32,feeAmount uint256,kind string,partiallyFillable bool,' +
  'sellTokenBalance string,buyTokenBalance string';
const VELORA_ORDER_FIELDS =
  'owner address,beneficiary address,srcToken address,destToken address,srcAmount uint256,' +
  'destAmount uint256,expectedAmount uint256,deadline uint256,kind uint8,nonce uint256,' +
  'partnerAndFee uint256,permit bytes,metadata bytes,bridge Bridge';
const ZERO = '0x0000000000000000000000000000000000000000';

function parse(typedData: unknown): any {
  if (typeof typedData !== 'string') return typedData;
  try {
    return JSON.parse(typedData);
  } catch {
    block('the message to sign is not valid typed data');
  }
}

function domainChain(domain: any, salted: boolean): number | undefined {
  const raw = domain?.chainId ?? (salted ? domain?.salt : undefined);
  try {
    return raw == null ? undefined : Number(BigInt(raw));
  } catch {
    return undefined;
  }
}

/**
 * Lets the wallet sign `typedData` only if it is one of the whitelisted
 * permits or orders, from and for `account`, on `chainId`, for no more than
 * the swap amount; returns what it is, for the log.
 */
export function checkJumperSignature(
  chainId: number,
  account: string,
  typedData: unknown,
  hints: AmountHints | undefined
): string {
  const data = parse(typedData);
  const { domain, types, message, primaryType } = data ?? {};
  const salted = primaryType === 'Permit';
  if (domainChain(domain, salted) !== chainId) {
    block(`signature for chain ${domain?.chainId ?? 'none'}, wallet is on ${chainId}`);
  }

  // LI.FI's own Permit2 transfer or EIP-2612 permit for its Permit2Proxy.
  if (
    (domain?.name === 'Permit2' && primaryType !== 'PermitSingle') ||
    (primaryType === 'Permit' && sameAddress(message?.spender, lifiPermit2Proxy(chainId)))
  ) {
    checkPermitSignature(chainId, account, data);
    if (primaryType === 'Permit') {
      withinSwap(chainId, domain.verifyingContract, toBig(message.value, 'permit amount'), hints);
    } else {
      withinSwap(chainId, message?.permitted?.token, toBig(message?.permitted?.amount, 'permit amount'), hints);
    }
    return 'LI.FI permit';
  }

  if (primaryType === 'Permit') {
    if (fieldsOf(types, 'Permit') !== EIP2612_FIELDS) block('not an EIP-2612 permit');
    const spender = String(message.spender ?? '').toLowerCase();
    const name =
      (cowOn(chainId) && spender === COW.vaultRelayer && 'CoW Protocol') ||
      (veloraOn(chainId) && spender === VELORA_DELTA && 'Velora Delta');
    if (!name) block(`permit for ${message.spender ?? 'nobody'} is not for a whitelisted contract`);
    if (!sameAddress(message.owner, account)) block('permit is not from the connected wallet');
    notAfter(message.deadline, MAX_PERMIT_SECONDS, 'permit deadline');
    withinSwap(chainId, domain.verifyingContract, toBig(message.value, 'permit amount'), hints);
    return `permit for ${name}`;
  }

  if (domain?.name === 'Permit2' && primaryType === 'PermitSingle') {
    if (!sameAddress(domain.verifyingContract, lifiPermit2(chainId))) block('signature for an unknown Permit2');
    if (
      fieldsOf(types, 'PermitSingle') !== PERMIT2_SINGLE_FIELDS ||
      fieldsOf(types, 'PermitDetails') !== PERMIT_DETAILS_FIELDS
    ) {
      block('not a Permit2 allowance');
    }
    const spender = String(message?.spender ?? '').toLowerCase();
    const name =
      (spender === UNISWAP_ROUTERS.get(chainId) && 'Uniswap router') ||
      (spender === TYCHO_ROUTERS.get(chainId) && 'FYND router');
    if (!name) block(`Permit2 allowance for ${message?.spender ?? 'nobody'} is not for a whitelisted contract`);
    notAfter(message.sigDeadline, MAX_PERMIT_SECONDS, 'permit deadline');
    notAfter(message.details?.expiration, MAX_PERMIT_SECONDS, 'Permit2 allowance expiry');
    withinSwap(chainId, message.details?.token, toBig(message.details?.amount, 'Permit2 allowance'), hints);
    return `Permit2 allowance for ${name}`;
  }

  if (domain?.name === 'Gnosis Protocol' && primaryType === 'Order') {
    if (!cowOn(chainId) || !sameAddress(domain.verifyingContract, COW.settlement)) {
      block('CoW order for an unknown settlement contract');
    }
    if (fieldsOf(types, 'Order') !== COW_ORDER_FIELDS) block('not a CoW order');
    if (!sameAddress(message.receiver, ZERO) && !sameAddress(message.receiver, account)) {
      block(`CoW order pays ${message.receiver}, not the connected wallet`);
    }
    notAfter(message.validTo, MAX_ORDER_SECONDS, 'CoW order expiry');
    const total = toBig(message.sellAmount, 'sell amount') + toBig(message.feeAmount ?? 0, 'fee amount');
    withinSwap(chainId, message.sellToken, total, hints);
    return 'CoW order';
  }

  if (domain?.name === 'Portikus' && primaryType === 'Order') {
    if (!veloraOn(chainId) || !sameAddress(domain.verifyingContract, VELORA_DELTA)) {
      block('Velora order for an unknown contract');
    }
    if (fieldsOf(types, 'Order') !== VELORA_ORDER_FIELDS) block('not a Velora Delta order');
    if (!sameAddress(message.owner, account)) block('Velora order is not from the connected wallet');
    if (!sameAddress(message.beneficiary, account)) {
      block(`Velora order pays ${message.beneficiary}, not the connected wallet`);
    }
    notAfter(message.deadline, MAX_ORDER_SECONDS, 'Velora order deadline');
    withinSwap(chainId, message.srcToken, toBig(message.srcAmount, 'sell amount'), hints);
    return 'Velora order';
  }

  block(`${domain?.name ?? 'unknown'} ${primaryType ?? 'message'} is not a whitelisted permit or order`);
}

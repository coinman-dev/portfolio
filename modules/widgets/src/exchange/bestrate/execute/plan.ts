import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';
import { NoRoute, ProviderId, QuoteRequest } from '../types';
import { RankedRoute } from '../search';
import { getJson, isNativeToken } from '../providers/common';
import { DLN_SOURCE, allowedContracts, receiverBytes } from './contracts';
import { relayRequestBody } from '../providers/relay';
import { socketQuoteUrl } from '../providers/socket';
import { kyberBuildUrl, kyberRoutesUrl } from '../providers/kyberswap';
import { debridgeChainId, debridgeCreateTxUrl } from '../providers/debridge';
import { lifiRoutesBody, lifiToolNames } from '../providers/lifi';
import { ThorLikeId, thorlikeConfig, thorlikeEvmSend } from '../providers/thorlike';
import { ACROSS_SPOKE_POOLS, acrossPeriphery, acrossSwapUrl } from '../providers/across';
import { VELORA_AUGUSTUS, veloraBuild, veloraPriceUrl } from '../providers/velora';
import { TrVars, tr } from '../i18n';

/** What gets tracked after the source transaction lands. */
export type StatusRef =
  | { kind: 'none' }
  | { kind: 'relay'; requestId: string }
  | { kind: 'debridge'; orderId: string }
  | { kind: 'socket'; quoteId: string }
  | { kind: 'lifi'; bridge: string; fromChain: number; toChain: number }
  | { kind: 'thorlike'; provider: ThorLikeId }
  | { kind: 'across'; originChainId: number };

type Hex = `0x${string}`;

/** One route turned into the exact transaction to sign, checked field by field. */
export interface ExecPlan {
  provider: ProviderId;
  providerName: string;
  via: string;
  chainId: number;
  user: Hex;
  receiver: string;
  /** ERC-20 input; null when the input is the native coin. */
  token: Hex | null;
  amount: bigint;
  /** Contract the input is approved to — exactly `amount`, never more. */
  spender?: Hex;
  tx: { to: Hex; data: Hex; value: bigint };
  /** Native coin sent on top of the input (deBridge's fixed fee). */
  extraValue: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  sameChain: boolean;
  status: StatusRef;
  builtAt: number;
}

const MAX_EXTRA_FEE_USD = 25;

/** Services whose routes can be signed here; the rest open their site. */
const EXECUTABLE: ProviderId[] = ['relay', 'socket', 'across', 'kyberswap', 'velora', 'debridge', 'lifi', 'maya', 'thorchain'];

export function executionBlocker(
  route: RankedRoute,
  req: QuoteRequest,
  walletChains: number[],
  /** The wallet's balance of the input token, when known. */
  balance?: bigint | null
): string | null {
  if (route.estimateOnly) return tr('only available on the site');
  if (!EXECUTABLE.includes(route.provider)) return tr('{provider} runs on its own site', { provider: route.providerName });
  if (req.fromChain.type !== 'EVM') return tr('sending from this network is not supported here yet');
  if (!walletChains.includes(req.fromChain.id)) {
    return tr('{chain} is not enabled in the wallet connection', { chain: req.fromChain.name });
  }
  if (!req.fromAddress) return tr('connect a wallet first');
  if (!req.toAddress) return tr('enter the {chain} receiver address', { chain: req.toChain.name });
  if (balance != null && balance < req.amount) return tr('not enough {symbol} in the wallet', { symbol: req.fromToken.symbol });
  return null;
}

const APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount)']);
const THORLIKE_ROUTER_ABI = parseAbi([
  'function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration) payable',
]);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ACROSS_DEPOSIT = parseAbi([
  'function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)',
  'function depositNative(address spokePool, address depositor, bytes32 recipient, address inputToken, uint256 inputAmount, bytes32 outputToken, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)',
]);
/** An EVM address as Across writes it in bytes32. */
const bytes32 = (address: string) => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;

const ORDER_CREATION =
  '(address giveTokenAddress,uint256 giveAmount,bytes takeTokenAddress,uint256 takeAmount,uint256 takeChainId,bytes receiverDst,address givePatchAuthoritySrc,bytes orderAuthorityAddressDst,bytes allowedTakerDst,bytes externalCall,bytes allowedCancelBeneficiarySrc)';
const DLN_ABI = parseAbi([
  `function createSaltedOrder(${ORDER_CREATION} _orderCreation, uint64 _salt, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope, bytes _metadata)`,
  `function createOrder(${ORDER_CREATION} _orderCreation, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope)`,
]);

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Refuses the plan; `reason` is English source text with `{name}` placeholders. */
function fail(reason: string, vars?: TrVars): never {
  throw new NoRoute(tr(reason, vars));
}

function baseFields(route: RankedRoute, req: QuoteRequest) {
  const native = isNativeToken(req.fromChain, req.fromToken);
  return {
    provider: route.provider,
    providerName: route.providerName,
    via: route.via,
    chainId: req.fromChain.id,
    user: req.fromAddress as Hex,
    receiver: req.toAddress as string,
    token: native ? null : (req.fromToken.address as Hex),
    amount: req.amount,
    sameChain: req.fromChain.id === req.toChain.id,
    builtAt: Date.now(),
  };
}

async function relayPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const body = await getJson('https://api.relay.link/quote', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(relayRequestBody(req, req.fromAddress!, req.toAddress!)),
  });
  if (body.details?.recipient && !same(body.details.recipient, req.toAddress)) fail('Relay quoted a different receiver');
  const items = (body.steps ?? []).flatMap((step: any) => (step.items ?? []).map((item: any) => ({ step, item })));
  if (items.some(({ step }: any) => step.kind !== 'transaction')) fail('this Relay route needs a signature — use relay.link');
  const approvals = items.filter(({ step }: any) => step.id === 'approve');
  const mains = items.filter(({ step }: any) => step.id !== 'approve');
  if (mains.length !== 1) fail('Relay returned {count} transactions; expected one', { count: mains.length });
  const main = mains[0];
  const data = main.item.data;
  if (Number(data.chainId) !== req.fromChain.id) fail('Relay transaction is for another chain');
  let spender: Hex | undefined;
  if (approvals.length) {
    const decoded = decodeFunctionData({ abi: APPROVE_ABI, data: approvals[0].item.data.data });
    spender = decoded.args[0] as Hex;
  }
  const requestId =
    main.step.requestId ?? new URLSearchParams(String(main.item.check?.endpoint ?? '').split('?')[1] ?? '').get('requestId');
  if (!requestId) fail('Relay did not return a request id to track');
  return {
    ...baseFields(route, req),
    spender,
    tx: { to: data.to, data: data.data, value: BigInt(data.value ?? 0) },
    extraValue: 0n,
    toAmount: BigInt(body.details.currencyOut.amount),
    toAmountMin: BigInt(body.details.currencyOut.minimumAmount ?? body.details.currencyOut.amount),
    status: { kind: 'relay', requestId },
  };
}

async function socketPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const body = await getJson(socketQuoteUrl(req, req.fromAddress!, req.toAddress!), { signal });
  if (!body.success) fail(body.message ?? 'Socket returned no route');
  if (!same(body.result?.receiverAddress, req.toAddress) && body.result?.receiverAddress !== req.toAddress) {
    fail('Socket quoted a different receiver');
  }
  const routes: any[] = body.result?.routes ?? [];
  const protocols = (r: any) =>
    [r.routeDetails?.dexDetails?.protocol?.displayName, r.routeDetails?.bridgeDetails?.protocol?.displayName]
      .filter(Boolean)
      .join(' → ') || 'Socket';
  const picked = routes.find((r) => protocols(r) === route.via) ?? routes[0];
  if (!picked) fail('Socket returned no route');
  const kind = picked.txData?.kind;
  if (kind && kind !== 'evm' && kind !== 'evm_tx') fail('Socket route of kind {kind} is not supported', { kind });
  const object = picked.txData?.object;
  if (!object?.to || !object?.data) fail('Socket returned no transaction');
  return {
    ...baseFields(route, req),
    via: protocols(picked),
    spender: picked.approval?.spenderAddress,
    tx: { to: object.to, data: object.data, value: BigInt(object.value ?? 0) },
    extraValue: 0n,
    toAmount: BigInt(picked.output.amount),
    toAmountMin: BigInt(picked.output.minAmountOut ?? picked.output.amount),
    status: { kind: 'socket', quoteId: picked.quoteId },
  };
}

async function kyberPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const routes = await getJson(kyberRoutesUrl(req), { signal, headers: { 'x-client-id': 'CoinMan' } });
  const summary = routes.data?.routeSummary;
  if (!summary) fail('KyberSwap returned no route');
  const built = await getJson(kyberBuildUrl(req), {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-client-id': 'CoinMan' },
    body: JSON.stringify({
      routeSummary: summary,
      sender: req.fromAddress,
      recipient: req.toAddress,
      slippageTolerance: req.slippageBps,
    }),
  });
  const data = built.data;
  if (!data?.data || !data?.routerAddress) fail('KyberSwap did not build a transaction');
  const native = isNativeToken(req.fromChain, req.fromToken);
  const toAmount = BigInt(data.amountOut);
  return {
    ...baseFields(route, req),
    spender: native ? undefined : data.routerAddress,
    tx: {
      to: data.routerAddress,
      data: data.data,
      value: BigInt(data.transactionValue ?? (native ? req.amount : 0n)),
    },
    extraValue: 0n,
    toAmount,
    toAmountMin: (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
    status: { kind: 'none' },
  };
}

async function debridgePlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const body = await getJson(debridgeCreateTxUrl(req, req.fromAddress!, req.toAddress!), { signal });
  const tx = body.tx;
  if (!tx?.to || !tx?.data) fail(body.errorMessage ?? 'deBridge returned no transaction');
  if (!same(tx.to, DLN_SOURCE)) fail('this deBridge route swaps first — open it on app.debridge.finance');

  const { args } = decodeFunctionData({ abi: DLN_ABI, data: tx.data });
  const order = args[0] as any;
  const receiver = receiverBytes(req.toAddress!);
  const native = isNativeToken(req.fromChain, req.fromToken);
  const giveToken = native ? '0x0000000000000000000000000000000000000000' : req.fromToken.address;
  if (!same(order.giveTokenAddress, giveToken)) fail('deBridge order gives a different token');
  if (order.giveAmount !== req.amount) fail('deBridge order gives a different amount');
  if (!same(order.receiverDst, receiver)) fail('deBridge order pays a different receiver');
  if (!same(order.orderAuthorityAddressDst, receiver)) fail('deBridge order is controlled by another address');
  if (!same(order.givePatchAuthoritySrc, req.fromAddress)) fail('deBridge order can be changed by another address');
  if (order.externalCall !== '0x') fail('deBridge order carries a call on the destination chain');
  if (order.allowedCancelBeneficiarySrc !== '0x' && !same(order.allowedCancelBeneficiarySrc, req.fromAddress)) {
    fail('deBridge order refunds to another address');
  }
  if (Number(order.takeChainId) !== debridgeChainId(req.toChain.id)) fail('deBridge order targets another chain');

  const fixFee = BigInt(body.fixFee ?? 0);
  return {
    ...baseFields(route, req),
    spender: native ? undefined : (DLN_SOURCE as Hex),
    tx: { to: tx.to, data: tx.data, value: BigInt(tx.value ?? 0) },
    extraValue: fixFee,
    toAmount: order.takeAmount,
    // DLN orders fill at exactly this amount or are cancelled and refunded.
    toAmountMin: order.takeAmount,
    status: { kind: 'debridge', orderId: body.orderId },
  };
}

async function lifiPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const headers = { 'content-type': 'application/json', 'x-lifi-integrator': 'CoinMan' };
  const found = await getJson('https://li.quest/v1/advanced/routes', {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(lifiRoutesBody(req)),
  });
  const routes: any[] = found.routes ?? [];
  const picked = routes.find((r) => lifiToolNames(r).join(' → ') === route.via) ?? routes[0];
  if (!picked) fail('LI.FI returned no route');
  if (picked.steps.length !== 1) fail('multi-step LI.FI route — use the LI.FI tab');
  const step = await getJson('https://li.quest/v1/advanced/stepTransaction', {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(picked.steps[0]),
  });
  const request = step.transactionRequest;
  if (!request?.to || !request?.data) fail('LI.FI returned no transaction');
  if (!same(step.action?.fromAddress, req.fromAddress)) fail('LI.FI built the transaction for another sender');
  if (!same(step.action?.toAddress, req.toAddress) && step.action?.toAddress !== req.toAddress) {
    fail('LI.FI quoted a different receiver');
  }
  const native = isNativeToken(req.fromChain, req.fromToken);
  // Some bridges take their fee in the native coin on top; LI.FI lists it
  // as a cost that is not included in the amount. Only that much may ride along.
  const nativeFees = (step.estimate?.feeCosts ?? [])
    .filter((c: any) => c.included === false && same(c.token?.address, req.fromChain.nativeAddress))
    .reduce((sum: bigint, c: any) => sum + BigInt(c.amount ?? 0), 0n);
  return {
    ...baseFields(route, req),
    via: lifiToolNames(picked).join(' → ') || route.via,
    spender: native ? undefined : step.estimate?.approvalAddress,
    tx: { to: request.to, data: request.data, value: BigInt(request.value ?? 0) },
    extraValue: nativeFees,
    toAmount: BigInt(step.estimate.toAmount),
    toAmountMin: BigInt(step.estimate.toAmountMin ?? step.estimate.toAmount),
    status: { kind: 'lifi', bridge: step.tool, fromChain: req.fromChain.id, toChain: req.toChain.id },
  };
}

/**
 * Across: the deposit is decoded and every field compared with what was
 * asked — depositor, receiver, tokens, amounts, destination, no call on the
 * other side. Routes that swap first go through the periphery's swap entry,
 * which cannot be checked this way, so they are signed on app.across.to.
 */
async function acrossPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const body = await getJson(acrossSwapUrl(req, req.fromAddress!, req.toAddress!), { signal });
  if (body.crossSwapType !== 'bridgeableToBridgeable') fail('this Across route swaps first — open it on app.across.to');
  const tx = body.swapTx;
  if (!tx?.to || !tx?.data) fail('Across returned no transaction');
  if (Number(tx.chainId) !== req.fromChain.id) fail('transaction is for another chain');
  if (!same(body.outputToken?.address, req.toToken.address)) fail('Across quoted another output token');
  const pool = ACROSS_SPOKE_POOLS[req.fromChain.id];
  const native = isNativeToken(req.fromChain, req.fromToken);
  const value = BigInt(tx.value ?? 0);
  const minOut = BigInt(body.minOutputAmount);
  const { functionName, args } = decodeFunctionData({ abi: ACROSS_DEPOSIT, data: tx.data });
  const a = args as readonly any[];
  // deposit: depositor, recipient, inputToken, outputToken, inputAmount, outputAmount, destinationChainId, …, message
  // depositNative: spokePool, depositor, recipient, inputToken, inputAmount, outputToken, outputAmount, destinationChainId, …, message
  const f = native
    ? { pool: a[0], depositor: bytes32(a[1]), recipient: a[2], input: a[4], outputToken: a[5], output: a[6], dest: a[7], message: a[12] }
    : { pool: tx.to, depositor: a[0], recipient: a[1], input: a[4], outputToken: a[3], output: a[5], dest: a[6], message: a[11] };
  if (native ? functionName !== 'depositNative' || !same(tx.to, acrossPeriphery(req.fromChain.id)) : functionName !== 'deposit') {
    fail('Across asked for an unexpected call');
  }
  if (!native && !same(a[2], bytes32(req.fromToken.address))) fail('Across deposit takes a different token');
  if (!same(f.pool, pool)) fail('Across deposit goes to another SpokePool');
  if (!same(f.depositor, bytes32(req.fromAddress!))) fail('Across deposit is credited to another address');
  if (!same(f.recipient, bytes32(req.toAddress!))) fail('Across deposit pays a different receiver');
  if (!same(f.outputToken, bytes32(body.steps?.bridge?.tokenOut?.address ?? ''))) fail('Across deposit pays a different token');
  if (f.input !== req.amount) fail('Across deposit takes a different amount');
  if (f.output !== minOut) fail('Across deposit promises a different amount');
  if (Number(f.dest) !== req.toChain.id) fail('Across deposit targets another chain');
  if (f.message !== '0x') fail('Across deposit carries a call on the destination chain');
  if (value !== (native ? req.amount : 0n)) fail('the transaction sends more native coin than the swap needs');
  const spender = body.checks?.allowance?.spender;
  if (!native && !same(spender, pool)) fail('Across asked to approve another contract');
  return {
    ...baseFields(route, req),
    spender: native ? undefined : (pool as Hex),
    tx: { to: tx.to, data: tx.data, value },
    extraValue: 0n,
    toAmount: BigInt(body.expectedOutputAmount),
    toAmountMin: minOut,
    status: { kind: 'across', originChainId: req.fromChain.id },
  };
}

/** Velora: same chain only, so the simulation checks what reaches the receiver. */
async function veloraPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const price = await getJson(veloraPriceUrl(req), { signal });
  const priceRoute = price.priceRoute;
  if (!priceRoute?.destAmount) fail('Velora returned no route');
  if (!same(priceRoute.contractAddress, VELORA_AUGUSTUS) || !same(priceRoute.tokenTransferProxy, VELORA_AUGUSTUS)) {
    fail('Velora named a contract that is not Augustus v6.2');
  }
  if (Number(priceRoute.partnerFee ?? 0) > 0) fail('Velora added a partner fee');
  const { url, body } = veloraBuild(req, priceRoute);
  const tx = await getJson(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!tx?.to || !tx?.data) fail('Velora did not build a transaction');
  if (Number(tx.chainId) !== req.fromChain.id) fail('transaction is for another chain');
  const native = isNativeToken(req.fromChain, req.fromToken);
  const toAmount = BigInt(priceRoute.destAmount);
  return {
    ...baseFields(route, req),
    spender: native ? undefined : (VELORA_AUGUSTUS as Hex),
    tx: { to: tx.to, data: tx.data, value: BigInt(tx.value ?? 0) },
    extraValue: 0n,
    toAmount,
    toAmountMin: (toAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
    status: { kind: 'none' },
  };
}

/**
 * Maya / THORChain from an EVM wallet: one call to the network's router, which
 * moves the input to the vault with the memo. The payout always comes later
 * in a transaction of its own, so even ETH → USDT is tracked as a transfer.
 */
async function thorlikePlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  const cfg = thorlikeConfig(route.provider);
  if (!cfg) fail('{provider} cannot be executed here', { provider: route.providerName });
  const send = await thorlikeEvmSend(cfg, req, route.thorlike?.streaming ?? false, signal);
  const native = isNativeToken(req.fromChain, req.fromToken);
  const data = encodeFunctionData({
    abi: THORLIKE_ROUTER_ABI,
    functionName: 'depositWithExpiry',
    args: [send.vault, (native ? ZERO_ADDRESS : req.fromToken.address) as Hex, req.amount, send.memo, send.expiry],
  });
  return {
    ...baseFields(route, req),
    sameChain: false,
    spender: native ? undefined : send.router,
    tx: { to: send.router, data, value: native ? req.amount : 0n },
    extraValue: 0n,
    toAmount: send.expectedOut,
    toAmountMin: send.minOut,
    status: { kind: 'thorlike', provider: cfg.id },
  };
}

export async function buildPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  if (!req.fromAddress || !req.toAddress) fail('sender and receiver addresses are required');
  const builders: Partial<Record<ProviderId, typeof relayPlan>> = {
    relay: relayPlan,
    socket: socketPlan,
    kyberswap: kyberPlan,
    velora: veloraPlan,
    across: acrossPlan,
    debridge: debridgePlan,
    lifi: lifiPlan,
    maya: thorlikePlan,
    thorchain: thorlikePlan,
  };
  const build = builders[route.provider];
  if (!build) fail('{provider} cannot be executed here', { provider: route.providerName });
  const plan = await build(route, req, signal);
  checkPlan(plan, req);
  return plan;
}

/**
 * The last word before the wallet: the transaction and the approval may only
 * reach this service's own contracts, and no more native coin may leave the
 * wallet than the input plus a known fee. Run again right before sending.
 */
export function checkPlan(plan: ExecPlan, req: QuoteRequest): void {
  const allowed = allowedContracts(plan.provider, plan.chainId);
  if (plan.chainId !== req.fromChain.id) fail('transaction is for another chain');
  if (!allowed.has(plan.tx.to.toLowerCase())) {
    fail('{provider} asked to call {address}, which is not one of its contracts', {
      provider: plan.providerName,
      address: plan.tx.to,
    });
  }
  if (plan.token) {
    if (!plan.spender) fail('{provider} did not name a contract to approve', { provider: plan.providerName });
    if (!allowed.has(plan.spender.toLowerCase())) {
      fail('{provider} asked to approve {address}, which is not one of its contracts', {
        provider: plan.providerName,
        address: plan.spender,
      });
    }
  }
  const maxValue = (plan.token ? 0n : plan.amount) + plan.extraValue;
  if (plan.tx.value > maxValue) fail('the transaction sends more native coin than the swap needs');
  // Fees in the native coin on top (deBridge, some LI.FI bridges) are a few dollars.
  const extraUSD = (Number(plan.extraValue) / 1e18) * req.fromNativePriceUSD;
  if (extraUSD > MAX_EXTRA_FEE_USD) fail('fixed fee of {usd}$ is unusually high', { usd: extraUSD.toFixed(2) });
  if (plan.toAmountMin > plan.toAmount) fail('minimum received is above the quote');
  if (plan.toAmountMin <= 0n) fail('no minimum amount to receive');
}

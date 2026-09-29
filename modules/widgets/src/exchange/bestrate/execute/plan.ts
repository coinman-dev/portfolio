import { decodeFunctionData, parseAbi } from 'viem';
import { NoRoute, ProviderId, QuoteRequest } from '../types';
import { RankedRoute } from '../search';
import { getJson, isNativeToken } from '../providers/common';
import { DLN_SOURCE, allowedContracts, receiverBytes } from './contracts';
import { relayRequestBody } from '../providers/relay';
import { socketQuoteUrl } from '../providers/socket';
import { kyberBuildUrl, kyberRoutesUrl } from '../providers/kyberswap';
import { debridgeChainId, debridgeCreateTxUrl } from '../providers/debridge';
import { lifiRoutesBody, lifiToolNames } from '../providers/lifi';

/** What gets tracked after the source transaction lands. */
export type StatusRef =
  | { kind: 'none' }
  | { kind: 'relay'; requestId: string }
  | { kind: 'debridge'; orderId: string }
  | { kind: 'socket'; quoteId: string }
  | { kind: 'lifi'; bridge: string; fromChain: number; toChain: number };

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
const EXECUTABLE: ProviderId[] = ['relay', 'socket', 'kyberswap', 'debridge', 'lifi'];

export function executionBlocker(
  route: RankedRoute,
  req: QuoteRequest,
  walletChains: number[],
  /** The wallet's balance of the input token, when known. */
  balance?: bigint | null
): string | null {
  if (route.estimateOnly) return 'only available on the site';
  if (!EXECUTABLE.includes(route.provider)) return `${route.providerName} runs on its own site`;
  if (req.fromChain.type !== 'EVM') return 'sending from this network is not supported here yet';
  if (!walletChains.includes(req.fromChain.id)) return `${req.fromChain.name} is not enabled in the wallet connection`;
  if (!req.fromAddress) return 'connect a wallet first';
  if (!req.toAddress) return `enter the ${req.toChain.name} receiver address`;
  if (balance != null && balance < req.amount) return `not enough ${req.fromToken.symbol} in the wallet`;
  return null;
}

const APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount)']);

const ORDER_CREATION =
  '(address giveTokenAddress,uint256 giveAmount,bytes takeTokenAddress,uint256 takeAmount,uint256 takeChainId,bytes receiverDst,address givePatchAuthoritySrc,bytes orderAuthorityAddressDst,bytes allowedTakerDst,bytes externalCall,bytes allowedCancelBeneficiarySrc)';
const DLN_ABI = parseAbi([
  `function createSaltedOrder(${ORDER_CREATION} _orderCreation, uint64 _salt, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope, bytes _metadata)`,
  `function createOrder(${ORDER_CREATION} _orderCreation, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope)`,
]);

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function fail(reason: string): never {
  throw new NoRoute(reason);
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
  if (mains.length !== 1) fail(`Relay returned ${mains.length} transactions; expected one`);
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
  if (kind && kind !== 'evm' && kind !== 'evm_tx') fail(`Socket route of kind ${kind} is not supported`);
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

export async function buildPlan(route: RankedRoute, req: QuoteRequest, signal: AbortSignal): Promise<ExecPlan> {
  if (!req.fromAddress || !req.toAddress) fail('sender and receiver addresses are required');
  const builders: Partial<Record<ProviderId, typeof relayPlan>> = {
    relay: relayPlan,
    socket: socketPlan,
    kyberswap: kyberPlan,
    debridge: debridgePlan,
    lifi: lifiPlan,
  };
  const build = builders[route.provider];
  if (!build) fail(`${route.providerName} cannot be executed here`);
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
    fail(`${plan.providerName} asked to call ${plan.tx.to}, which is not one of its contracts`);
  }
  if (plan.token) {
    if (!plan.spender) fail(`${plan.providerName} did not name a contract to approve`);
    if (!allowed.has(plan.spender.toLowerCase())) {
      fail(`${plan.providerName} asked to approve ${plan.spender}, which is not one of its contracts`);
    }
  }
  const maxValue = (plan.token ? 0n : plan.amount) + plan.extraValue;
  if (plan.tx.value > maxValue) fail('the transaction sends more native coin than the swap needs');
  // Fees in the native coin on top (deBridge, some LI.FI bridges) are a few dollars.
  const extraUSD = (Number(plan.extraValue) / 1e18) * req.fromNativePriceUSD;
  if (extraUSD > MAX_EXTRA_FEE_USD) fail(`fixed fee of ${extraUSD.toFixed(2)}$ is unusually high`);
  if (plan.toAmountMin > plan.toAmount) fail('minimum received is above the quote');
  if (plan.toAmountMin <= 0n) fail('no minimum amount to receive');
}

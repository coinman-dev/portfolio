import { ChainType, FeeLine, NoRoute, Provider, QuoteRequest } from '../types';
import { amountUSD, getJson, humanAmount, isNativeToken, sameChain } from './common';

/**
 * deBridge (DLN): 0.04% of the input plus a fixed fee in the source chain's
 * native coin, paid on top. Cross-chain only — its same-chain swaps run
 * through other aggregators on terms it does not publish.
 */
const CHAIN_IDS: Record<number, number> = {
  1: 1,
  10: 10,
  56: 56,
  137: 137,
  8453: 8453,
  42161: 42161,
  43114: 43114,
  59144: 59144,
  4663: 4663,
  5042: 5042,
  1151111081099710: 7565164, // Solana
  728126428: 100000026, // Tron
  25: 100000019, // Cronos
  999: 100000022, // HyperEVM
  143: 100000030, // Monad
  4326: 100000031, // MegaETH
  1514: 100000013, // Story
  1776: 100000029, // Injective
};

const NATIVE_DECIMALS: Partial<Record<ChainType, number>> = { EVM: 18, SVM: 9, TVM: 6 };

function tokenOf(req: QuoteRequest, side: 'from' | 'to'): string {
  const chain = side === 'from' ? req.fromChain : req.toChain;
  const token = side === 'from' ? req.fromToken : req.toToken;
  if (!isNativeToken(chain, token)) return token.address;
  if (chain.type === 'EVM') return '0x0000000000000000000000000000000000000000';
  if (chain.type === 'SVM') return '11111111111111111111111111111111';
  throw new NoRoute(`native ${chain.nativeSymbol} is not mapped for deBridge`);
}

export function debridgeChainId(lifiChainId: number): number {
  const id = CHAIN_IDS[lifiChainId];
  if (!id) throw new NoRoute('chain not supported');
  return id;
}

/**
 * Without addresses the API only estimates; with them it also returns the
 * order transaction, paying `receiver` and refundable to `user`.
 */
export function debridgeCreateTxUrl(req: QuoteRequest, user?: string, receiver?: string): string {
  if (sameChain(req)) throw new NoRoute('cross-chain only');
  const params = new URLSearchParams({
    srcChainId: String(debridgeChainId(req.fromChain.id)),
    srcChainTokenIn: tokenOf(req, 'from'),
    srcChainTokenInAmount: req.amount.toString(),
    dstChainId: String(debridgeChainId(req.toChain.id)),
    dstChainTokenOut: tokenOf(req, 'to'),
    dstChainTokenOutAmount: 'auto',
    prependOperatingExpenses: 'false',
  });
  if (user && receiver) {
    params.set('dstChainTokenOutRecipient', receiver);
    params.set('srcChainOrderAuthorityAddress', user);
    params.set('dstChainOrderAuthorityAddress', receiver);
    params.set('senderAddress', user);
  }
  return `https://dln.debridge.finance/v1.0/dln/order/create-tx?${params}`;
}

export const debridgeProvider: Provider = {
  id: 'debridge',
  name: 'deBridge',
  async quote(req, signal) {
    const body = await getJson(debridgeCreateTxUrl(req), { signal });
    const src = debridgeChainId(req.fromChain.id);
    const dst = debridgeChainId(req.toChain.id);
    const inputToken = tokenOf(req, 'from');
    const outputToken = tokenOf(req, 'to');
    const estimation = body.estimation;
    if (!estimation?.dstChainTokenOut) throw new NoRoute(body.errorMessage ?? 'no route');

    const out = estimation.dstChainTokenOut;
    const nativeDecimals = NATIVE_DECIMALS[req.fromChain.type] ?? 18;
    const fixedFeeUSD = (Number(body.fixFee ?? 0) / 10 ** nativeDecimals) * req.fromNativePriceUSD;
    // `protocolFee` is counted in whatever token deBridge swaps the input
    // into first, so the USD figure from the cost breakdown is the one to use.
    const costUSD = (type: string) =>
      Number((estimation.costsDetails ?? []).find((c: any) => c.type === type)?.payload?.feeApproximateUsdValue) || 0;
    const protocolFeeUSD = costUSD('DlnProtocolFee');
    const inputUSD = Number(estimation.srcChainTokenIn?.approximateUsdValue) || amountUSD(req.amount, req.fromToken);
    const fees: FeeLine[] = [
      { label: 'deBridge fee', usd: protocolFeeUSD, included: true },
      { label: 'Solver margin and costs', usd: costUSD('TakerMargin') + costUSD('EstimatedOperatingExpenses'), included: true },
      { label: `Fixed fee in ${req.fromChain.nativeSymbol}`, usd: fixedFeeUSD, included: false },
    ].filter((line) => line.usd > 0);
    const site = new URLSearchParams({
      inputChain: String(src),
      inputCurrency: inputToken,
      outputChain: String(dst),
      outputCurrency: outputToken,
      amount: humanAmount(req.amount, req.fromToken.decimals),
      dlnMode: 'simple',
    });
    return [
      {
        id: `debridge:${body.orderId ?? 'estimate'}`,
        provider: 'debridge',
        providerName: 'deBridge',
        via: 'deBridge DLN',
        toAmount: BigInt(out.recommendedAmount ?? out.amount),
        toUSD: Number(out.recommendedApproximateUsdValue ?? out.approximateUsdValue) || 0,
        gasUSD: null,
        extraUSD: fixedFeeUSD,
        serviceFeePct: inputUSD > 0 ? (protocolFeeUSD / inputUSD) * 100 : null,
        fees,
        durationSec: body.order?.approximateFulfillmentDelay,
        reliability: 3,
        site: { name: 'app.debridge.finance', url: `https://app.debridge.finance/deswap?${site}` },
      },
    ];
  },
};

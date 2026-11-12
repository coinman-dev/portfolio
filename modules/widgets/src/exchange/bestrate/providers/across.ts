import { FeeLine, NoRoute, Provider, QuoteRequest } from '../types';
import { amountUSD, getJson, receiverOf, sameChain, senderOf } from './common';
import { tr } from '../i18n';

/**
 * Across: intent bridge between EVM chains. Across itself takes nothing (no
 * treasury or app fee); the relayer who fills the transfer charges a capital
 * fee (about 0.01%) and the destination gas, both already out of the amount
 * quoted. The swap API is public, needs no key and returns the transaction.
 */
const ACROSS_API = 'https://app.across.to/api';

/**
 * SpokePool per chain, from across-protocol/contracts broadcast/deployed-addresses.json
 * (checked 2026-11-04). Plain token deposits go straight to it; native ETH
 * goes through SpokePoolPeriphery.depositNative, which forwards to it.
 */
export const ACROSS_SPOKE_POOLS: Record<number, string> = {
  1: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5',
  10: '0x6f26bf09b1c792e3228e5467807a900a503c0281',
  56: '0x4e8e101924ede233c13e2d8622dc8aed2872d505',
  130: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64',
  137: '0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096',
  143: '0xd2ecb3afe598b746f8123cae365a598da831a449',
  324: '0xe0b015e54d54fc84a6cb9b666099c46ade9335ff',
  480: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64',
  999: '0x35e63ea3eb0fb7a3bc543c71fb66412e1f6b0e04',
  1135: '0x9552a0a6624a23b848060ae5901659cdda1f83f8',
  1868: '0x3bad7ad0728f9917d1bf08af5782dcbd516cdd96',
  4326: '0x3db06da8f0a24a525f314eec954fc5c6a973d40e',
  4663: '0xd29c85f15df544ba632c9e25829fd29d767d7978',
  8453: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64',
  9745: '0x50039faefebef707cfd94d6d462fe6d10b39207a',
  34443: '0x3bad7ad0728f9917d1bf08af5782dcbd516cdd96',
  42161: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a',
  43114: '0xfe9d541c92e4e90437c7152a00244886de37a658',
  57073: '0xef684c38f94f48775959ecf2012d7e864ffb9dd4',
  59144: '0x7e63a5f1a8f0b4d0934b2f2327daed3f6bb2ee75',
  81457: '0x2d509190ed0172ba588407d4c2df918f955cc6e1',
  534352: '0x3bad7ad0728f9917d1bf08af5782dcbd516cdd96',
  7777777: '0x13fdac9f9b4777705db45291bbff3c972c6d1d97',
};
/** SpokePoolPeriphery; zkSync has its own deployment. */
export const acrossPeriphery = (chainId: number) =>
  chainId === 324 ? '0x7c99ced6d8011af8a52488884f7ba2c61b0fa57d' : '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4';

export function acrossSwapUrl(req: QuoteRequest, depositor: string, recipient: string): string {
  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount: req.amount.toString(),
    inputToken: req.fromToken.address,
    outputToken: req.toToken.address,
    originChainId: String(req.fromChain.id),
    destinationChainId: String(req.toChain.id),
    depositor,
    recipient,
    slippage: String(req.slippageBps / 10_000),
  });
  return `${ACROSS_API}/swap/approval?${params}`;
}

export const acrossStatusUrl = (originChainId: number, hash: string) =>
  `${ACROSS_API}/deposit/status?originChainId=${originChainId}&depositTxHash=${hash}`;

/** Across writes fee shares as fractions scaled by 1e18. */
const pct18 = (value: unknown) => Number(BigInt(String(value ?? 0))) / 1e16;

export const acrossProvider: Provider = {
  id: 'across',
  name: 'Across',
  async quote(req, signal) {
    if (sameChain(req)) throw new NoRoute(tr('cross-chain only'));
    if (!ACROSS_SPOKE_POOLS[req.fromChain.id] || !ACROSS_SPOKE_POOLS[req.toChain.id]) {
      throw new NoRoute(tr('{chain} is not supported', { chain: ACROSS_SPOKE_POOLS[req.fromChain.id] ? req.toChain.name : req.fromChain.name }));
    }
    const body = await getJson(acrossSwapUrl(req, senderOf(req), receiverOf(req)), { signal });
    if (!body.expectedOutputAmount) throw new NoRoute(body.message ?? 'no route');
    const toAmount = BigInt(body.expectedOutputAmount);
    const details = body.steps?.bridge?.fees?.details ?? {};
    const relayerPct = pct18(details.relayerCapital?.pct) + pct18(details.lp?.pct);
    const usd = (part: any) => Number(part?.amountUsd ?? 0) || amountUSD(BigInt(String(part?.amount ?? 0)), req.fromToken);
    const bridgeDetails = body.fees?.total?.details?.bridge?.details ?? {};
    const fees: FeeLine[] = [
      { label: 'Relayer capital fee', usd: usd(bridgeDetails.relayerCapital), included: true },
      { label: 'Destination gas', usd: usd(bridgeDetails.destinationGas), included: true },
    ];
    const swaps = body.crossSwapType !== 'bridgeableToBridgeable';
    const originGas = Number(body.fees?.originGas?.amountUsd ?? 0);
    return [
      {
        id: `across:${body.id ?? 'quote'}`,
        provider: 'across',
        providerName: 'Across',
        via: swaps ? tr('Across, with a swap') : 'Across',
        toAmount,
        toAmountMin: body.minOutputAmount ? BigInt(body.minOutputAmount) : undefined,
        toUSD: amountUSD(toAmount, req.toToken),
        gasUSD: originGas > 0 ? originGas : null,
        extraUSD: 0,
        serviceFeePct: relayerPct,
        serviceFeeNote: "the relayer's capital fee; Across itself takes none",
        fees,
        durationSec: Number(body.expectedFillTime) || undefined,
        reliability: 3,
        site: { name: 'app.across.to', url: 'https://app.across.to/bridge' },
        note: swaps ? 'This route swaps tokens first; it is signed on app.across.to.' : undefined,
      },
    ];
  },
};

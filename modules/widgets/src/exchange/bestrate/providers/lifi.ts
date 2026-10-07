import { FeeLine, Provider, QuoteRequest, RouteQuote } from '../types';
import { getJson, humanAmount, reliabilityOf } from './common';

/** LI.FI's own cut on every integration but Jumper. */
const LIFI_FEE_NAME = 'LIFI Fixed Fee';

export function jumperUrl(req: QuoteRequest): string {
  const params = new URLSearchParams({
    fromAmount: humanAmount(req.amount, req.fromToken.decimals),
    fromChain: String(req.fromChain.id),
    fromToken: req.fromToken.address,
    toChain: String(req.toChain.id),
    toToken: req.toToken.address,
  });
  return `https://jumper.xyz/?${params}`;
}

export function lifiRoutesBody(req: QuoteRequest) {
  return {
    fromChainId: req.fromChain.id,
    toChainId: req.toChain.id,
    fromTokenAddress: req.fromToken.address,
    toTokenAddress: req.toToken.address,
    fromAmount: req.amount.toString(),
    ...(req.fromAddress ? { fromAddress: req.fromAddress } : {}),
    ...(req.toAddress ? { toAddress: req.toAddress } : {}),
    options: {
      integrator: 'CoinMan',
      slippage: req.slippageBps / 10_000,
      order: 'CHEAPEST',
      allowSwitchChain: false,
    },
  };
}

export function lifiToolNames(route: any): string[] {
  const names = (route.steps ?? []).flatMap((step: any) =>
    (step.includedSteps?.length ? step.includedSteps : [step]).map((s: any) => s.toolDetails?.name ?? s.tool)
  );
  // The fee collection shows up as its own "tool".
  return [...new Set<string>(names.filter((n: string) => n && !/fee/i.test(n)))];
}

export const lifiProvider: Provider = {
  id: 'lifi',
  name: 'LI.FI',
  async quote(req, signal) {
    const body = await getJson('https://li.quest/v1/advanced/routes', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-lifi-integrator': 'CoinMan' },
      body: JSON.stringify(lifiRoutesBody(req)),
    });

    const site = { name: 'jumper.xyz', url: jumperUrl(req) };
    const routes: RouteQuote[] = [];
    for (const route of body.routes ?? []) {
      const costs = (route.steps ?? []).flatMap((step: any) => step.estimate?.feeCosts ?? []);
      const fees: FeeLine[] = costs.map((c: any) => ({
        label: c.name,
        usd: Number(c.amountUSD) || 0,
        included: c.included !== false,
      }));
      const lifiFee = costs.filter((c: any) => c.name === LIFI_FEE_NAME);
      const tools = lifiToolNames(route);
      routes.push({
        id: `lifi:${route.id}`,
        provider: 'lifi',
        providerName: 'LI.FI',
        via: tools.join(' → ') || 'LI.FI',
        toAmount: BigInt(route.toAmount),
        toAmountMin: route.toAmountMin ? BigInt(route.toAmountMin) : undefined,
        toUSD: Number(route.toAmountUSD) || 0,
        gasUSD: route.gasCostUSD != null ? Number(route.gasCostUSD) : null,
        extraUSD: fees.filter((f) => !f.included).reduce((sum, f) => sum + f.usd, 0),
        serviceFeePct: lifiFee.reduce((sum: number, c: any) => sum + Number(c.percentage ?? 0) * 100, 0),
        fees,
        durationSec: (route.steps ?? []).reduce((sum: number, s: any) => sum + (s.estimate?.executionDuration ?? 0), 0),
        reliability: reliabilityOf(tools),
        site,
      });
    }

    // The same best route on jumper.xyz, where LI.FI takes no cut of its own.
    const best = routes[0];
    const cut = best?.fees.find((f) => f.label === LIFI_FEE_NAME);
    if (best && cut && best.serviceFeePct) {
      const keptPpm = BigInt(Math.round((1 - best.serviceFeePct / 100) * 1_000_000));
      routes.push({
        ...best,
        id: 'jumper:estimate',
        provider: 'jumper',
        providerName: 'Jumper',
        toAmount: (best.toAmount * 1_000_000n) / keptPpm,
        toAmountMin: undefined,
        toUSD: best.toUSD + cut.usd,
        serviceFeePct: 0,
        fees: best.fees.filter((f) => f.label !== LIFI_FEE_NAME),
        estimateOnly: true,
        note: 'Estimate: the LI.FI route without its 0.25% fee. Available only on jumper.xyz (closed source, flagged by some antivirus).',
      });
    }
    return routes;
  },
};

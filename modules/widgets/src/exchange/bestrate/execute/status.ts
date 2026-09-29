import { ExecPlan } from './plan';

export type DeliveryState = 'pending' | 'done' | 'refunded' | 'failed';

export interface Delivery {
  state: DeliveryState;
  detail?: string;
}

const POLL_MS = 6_000;
const GIVE_UP_MS = 60 * 60_000;

async function json(url: string, signal: AbortSignal): Promise<any> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** One look at where a cross-chain transfer stands, in each service's own terms. */
async function checkOnce(plan: ExecPlan, hash: string, signal: AbortSignal): Promise<Delivery> {
  const ref = plan.status;
  switch (ref.kind) {
    case 'none':
      return { state: 'done' };
    case 'relay': {
      const body = await json(`https://api.relay.link/intents/status?requestId=${ref.requestId}`, signal);
      const status = String(body.status ?? '').toLowerCase();
      if (status === 'success') return { state: 'done' };
      if (status === 'refund' || status === 'refunded') return { state: 'refunded', detail: body.details };
      if (status === 'failure') return { state: 'failed', detail: body.details };
      return { state: 'pending', detail: status };
    }
    case 'debridge': {
      const body = await json(`https://dln.debridge.finance/v1.0/dln/order/${ref.orderId}/status`, signal);
      const status = String(body.status ?? '');
      if (['Fulfilled', 'SentUnlock', 'ClaimedUnlock'].includes(status)) return { state: 'done' };
      if (['OrderCancelled', 'SentOrderCancel', 'ClaimedOrderCancel'].includes(status)) return { state: 'refunded' };
      return { state: 'pending', detail: status };
    }
    case 'socket': {
      const body = await json(`https://public-backend.socket.tech/v3/swap/status?quoteId=${ref.quoteId}`, signal);
      const status = String(body.result?.status ?? body.status ?? '').toUpperCase();
      if (status === 'COMPLETED') return { state: 'done' };
      if (status === 'REFUNDED') return { state: 'refunded' };
      if (status === 'FAILED' || status === 'EXPIRED') return { state: 'failed', detail: status };
      return { state: 'pending', detail: status };
    }
    case 'lifi': {
      const params = new URLSearchParams({
        txHash: hash,
        bridge: ref.bridge,
        fromChain: String(ref.fromChain),
        toChain: String(ref.toChain),
      });
      const body = await json(`https://li.quest/v1/status?${params}`, signal);
      if (body.status === 'DONE') {
        return body.substatus === 'REFUNDED' ? { state: 'refunded' } : { state: 'done', detail: body.substatus };
      }
      if (body.status === 'FAILED' || body.status === 'INVALID') return { state: 'failed', detail: body.substatusMessage };
      return { state: 'pending', detail: body.substatus };
    }
  }
}

/** Polls until the transfer lands, is refunded or fails; stops on `signal`. */
export async function watchDelivery(
  plan: ExecPlan,
  hash: string,
  onUpdate: (d: Delivery) => void,
  signal: AbortSignal
): Promise<Delivery> {
  const started = Date.now();
  while (!signal.aborted) {
    try {
      const delivery = await checkOnce(plan, hash, signal);
      onUpdate(delivery);
      if (delivery.state !== 'pending') return delivery;
    } catch {
      // A missed poll is not a failed transfer — try again.
    }
    if (Date.now() - started > GIVE_UP_MS) {
      const stale: Delivery = { state: 'pending', detail: 'still in progress after an hour — check the explorer' };
      onUpdate(stale);
      return stale;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { state: 'pending' };
}

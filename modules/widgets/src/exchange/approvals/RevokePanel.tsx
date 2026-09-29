import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits, type Address } from 'viem';
import { openExternal } from '../../earn/openExternal';
import { fetchChains, fetchTokens } from '../bestrate/catalog';
import { formatUSD, shortAddress } from '../bestrate/format';
import { connectTron } from '../../wallet/tron';
import { connectSolana } from '../../wallet/solana';
import { EVM_SCAN_CHAINS, txUrl } from './chains';
import { CallState, EvmChainPlan, isUserRejection, prepareEvmChain, runEvmChain } from './evm/revoke';
import { TronRevokePlan, prepareTronRevokes, sendTronRevoke } from './tron';
import { SolanaRevokeBatch, prepareSolanaRevokes, sendSolanaRevokes } from './solana';
import { RevokeRecord, newRecordId, saveRevokeRecord } from './history';
import { Approval, Family } from './types';

/**
 * Review, then send, a set of revokes across networks: what each network
 * costs and how many times the wallet will ask, then one network after
 * another — EVM first, then Tron, then Solana.
 */

interface Step {
  label: string;
  ids: string[];
  state: CallState;
  hash?: string;
  detail?: string;
}

interface Group {
  key: string;
  family: Family;
  chainId: number;
  chainName: string;
  approvals: Approval[];
  prepared: boolean;
  blocker?: string;
  needsWallet?: 'TVM' | 'SVM';
  fee?: string;
  feeUSD?: number;
  confirmations: number;
  steps: Step[];
  evm?: EvmChainPlan;
  tron?: TronRevokePlan[];
  sol?: SolanaRevokeBatch[];
}

export interface Owners {
  EVM?: string;
  TVM?: string;
  SVM?: string;
}

const FAMILY_ORDER: Family[] = ['EVM', 'TVM', 'SVM'];
const STATE_LABELS: Record<CallState, string> = {
  waiting: 'waiting',
  wallet: 'confirm in your wallet',
  pending: 'sent, waiting for the network',
  done: 'revoked',
  failed: 'failed',
  skipped: 'skipped',
};

async function nativePrice(chainId: number): Promise<number> {
  const [chains, tokens] = await Promise.all([fetchChains(), fetchTokens(chainId)]);
  const native = chains.find((c) => c.id === chainId)?.nativeAddress?.toLowerCase();
  return tokens.find((t) => t.address.toLowerCase() === native)?.priceUSD ?? 0;
}

function groupsOf(approvals: Approval[]): Group[] {
  const map = new Map<string, Group>();
  for (const a of approvals) {
    const key = a.family === 'EVM' ? `EVM:${a.chainId}` : a.family;
    let group = map.get(key);
    if (!group) {
      group = { key, family: a.family, chainId: a.chainId, chainName: a.chainName, approvals: [], prepared: false, confirmations: 0, steps: [] };
      map.set(key, group);
    }
    group.approvals.push(a);
  }
  return [...map.values()].sort(
    (x, y) => FAMILY_ORDER.indexOf(x.family) - FAMILY_ORDER.indexOf(y.family) || x.chainName.localeCompare(y.chainName)
  );
}

const shortError = (err: any) => String(err?.shortMessage ?? err?.message ?? err).split('\n')[0].slice(0, 200);

export const RevokePanel: React.FC<{
  approvals: Approval[];
  owners: Owners;
  onClose: (touched: string[]) => void;
}> = ({ approvals, owners, onClose }) => {
  const [groups, setGroups] = useState<Group[]>(() => groupsOf(approvals));
  const [phase, setPhase] = useState<'review' | 'running' | 'finished'>('review');
  const stop = useRef(false);
  const abort = useRef(new AbortController());
  const touched = useRef(new Set<string>());

  const patchGroup = useCallback((key: string, patch: Partial<Group> | ((g: Group) => Partial<Group>)) => {
    setGroups((list) => list.map((g) => (g.key === key ? { ...g, ...(typeof patch === 'function' ? patch(g) : patch) } : g)));
  }, []);

  const patchStep = useCallback((key: string, index: number, patch: Partial<Step>) => {
    patchGroup(key, (g) => ({ steps: g.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }, [patchGroup]);

  const prepare = useCallback(async (group: Group) => {
    const signal = abort.current.signal;
    const owner = owners[group.family];
    try {
      if (!owner) {
        patchGroup(group.key, {
          prepared: true,
          needsWallet: group.family === 'EVM' ? undefined : group.family,
          blocker: `Connect the ${group.family === 'TVM' ? 'Tron' : group.family === 'SVM' ? 'Solana' : 'EVM'} wallet that holds these approvals`,
        });
        return;
      }
      if (group.family === 'EVM') {
        const chain = EVM_SCAN_CHAINS.find((c) => c.id === group.chainId)!;
        const [plan, price] = await Promise.all([
          prepareEvmChain(chain.id, chain.name, chain.nativeSymbol, owner as Address, group.approvals),
          nativePrice(chain.id).catch(() => 0),
        ]);
        const cost = plan.cost != null ? Number(formatUnits(plan.cost, chain.chain.nativeCurrency.decimals)) : undefined;
        patchGroup(group.key, {
          prepared: true,
          evm: plan,
          blocker: plan.blocker,
          fee: cost != null ? `${cost.toPrecision(3)} ${chain.nativeSymbol}` : undefined,
          feeUSD: cost != null && price ? cost * price : undefined,
          confirmations: plan.calls.filter((c) => !c.error).length,
          steps: plan.calls.map((c) => ({ label: c.label, ids: c.ids, state: c.error ? 'skipped' : 'waiting', detail: c.error })),
        });
      } else if (group.family === 'TVM') {
        const [prep, price] = await Promise.all([
          prepareTronRevokes(owner, group.approvals, signal),
          nativePrice(group.chainId).catch(() => 0),
        ]);
        const trx = Number(prep.total) / 1e6;
        patchGroup(group.key, {
          prepared: true,
          tron: prep.plans,
          blocker: prep.blocker ?? (prep.plans.every((p) => p.error) ? 'Every revoke here would fail' : undefined),
          fee: `≤ ${trx.toFixed(2)} TRX`,
          feeUSD: price ? trx * price : undefined,
          confirmations: prep.plans.filter((p) => !p.error).length,
          steps: prep.plans.map((p) => ({
            label: `${p.approval.symbol} → ${p.approval.spenderInfo.name ?? shortAddress(p.approval.spender)}`,
            ids: [p.approval.id],
            state: p.error ? 'skipped' : 'waiting',
            detail: p.error,
          })),
        });
      } else {
        const [prep, price] = await Promise.all([
          prepareSolanaRevokes(owner, group.approvals, signal),
          nativePrice(group.chainId).catch(() => 0),
        ]);
        const sol = Number(prep.total) / 1e9;
        patchGroup(group.key, {
          prepared: true,
          sol: prep.batches,
          blocker: prep.blocker ?? (prep.batches.every((b) => b.error) ? 'Every revoke here would fail' : undefined),
          fee: `${sol} SOL`,
          feeUSD: price ? sol * price : undefined,
          confirmations: prep.batches.filter((b) => !b.error).length,
          steps: prep.batches.map((b) => ({
            label: b.approvals.map((a) => a.symbol).join(', '),
            ids: b.approvals.map((a) => a.id),
            state: b.error ? 'skipped' : 'waiting',
            detail: b.error,
          })),
        });
      }
    } catch (err) {
      patchGroup(group.key, { prepared: true, blocker: shortError(err) });
    }
  }, [owners, patchGroup]);

  useEffect(() => {
    const controller = abort.current;
    groupsOf(approvals).forEach((g) => void prepare(g));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (group: Group, step: Step, status: RevokeRecord['status'], record: { id?: string; createdAt?: number }) => {
    const items = group.approvals
      .filter((a) => step.ids.includes(a.id))
      .map((a) => ({ kind: a.kind, token: a.token, symbol: a.symbol, spender: a.spender, spenderName: a.spenderInfo.name }));
    record.id ??= newRecordId();
    record.createdAt ??= Date.now();
    void saveRevokeRecord({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: Date.now(),
      family: group.family,
      chainId: group.chainId,
      chainName: group.chainName,
      owner: owners[group.family] ?? '',
      items,
      tx: step.hash,
      status,
      detail: step.detail,
    });
  };

  const runGroup = async (group: Group) => {
    const owner = owners[group.family]!;
    const signal = abort.current.signal;
    touched.current.add(group.key);
    patchGroup(group.key, { blocker: undefined });
    if (group.family === 'EVM' && group.evm) {
      const records = new Map<number, { id?: string; createdAt?: number }>();
      const steps = group.steps.map((s) => ({ ...s }));
      try {
        await runEvmChain(
          group.evm,
          owner as Address,
          group.approvals,
          (p) => {
            steps[p.index] = { ...steps[p.index], state: p.state, hash: p.hash ?? steps[p.index].hash, detail: p.detail };
            patchStep(group.key, p.index, steps[p.index]);
            if (!records.has(p.index)) records.set(p.index, {});
            const record = records.get(p.index)!;
            if (p.state === 'pending' && steps[p.index].hash) save(group, steps[p.index], 'pending', record);
            if (p.state === 'done' || p.state === 'failed') save(group, steps[p.index], p.state, record);
          },
          () => stop.current
        );
      } catch (err) {
        patchGroup(group.key, { blocker: shortError(err) });
      }
      return;
    }
    if (group.family === 'TVM' && group.tron) {
      for (const [index, plan] of group.tron.entries()) {
        if (plan.error) continue;
        if (stop.current) {
          patchStep(group.key, index, { state: 'skipped', detail: 'stopped' });
          continue;
        }
        patchStep(group.key, index, { state: 'wallet' });
        try {
          const result = await sendTronRevoke(owner, plan, signal);
          const patch = { state: (result.ok ? 'done' : 'failed') as CallState, hash: result.txid, detail: result.detail };
          patchStep(group.key, index, patch);
          save(group, { ...group.steps[index], ...patch }, result.ok ? 'done' : 'failed', {});
        } catch (err) {
          patchStep(group.key, index, { state: 'skipped', detail: isUserRejection(err) ? 'declined in the wallet' : shortError(err) });
        }
      }
      return;
    }
    if (group.family === 'SVM' && group.sol) {
      for (const [index, batch] of group.sol.entries()) {
        if (batch.error) continue;
        if (stop.current) {
          patchStep(group.key, index, { state: 'skipped', detail: 'stopped' });
          continue;
        }
        patchStep(group.key, index, { state: 'wallet' });
        try {
          const result = await sendSolanaRevokes(owner, batch.approvals, signal);
          const patch = { state: (result.ok ? 'done' : 'failed') as CallState, hash: result.signature, detail: result.detail };
          patchStep(group.key, index, patch);
          save(group, { ...group.steps[index], ...patch }, result.ok ? 'done' : 'failed', {});
        } catch (err) {
          patchStep(group.key, index, { state: 'skipped', detail: isUserRejection(err) ? 'declined in the wallet' : shortError(err) });
        }
      }
    }
  };

  const start = async () => {
    setPhase('running');
    stop.current = false;
    for (const group of groups) {
      if (group.blocker || !group.prepared) continue;
      if (stop.current) break;
      await runGroup(group);
    }
    setPhase('finished');
  };

  const connectFor = async (group: Group) => {
    try {
      const address = group.needsWallet === 'TVM' ? await connectTron() : await connectSolana();
      patchGroup(group.key, { blocker: `Connected ${shortAddress(address)} — close this and scan again to use it` });
    } catch (err) {
      if (!isUserRejection(err)) patchGroup(group.key, { blocker: shortError(err) });
    }
  };

  const allPrepared = groups.every((g) => g.prepared);
  const runnable = groups.filter((g) => g.prepared && !g.blocker && g.confirmations > 0);
  const totalUSD = runnable.reduce((sum, g) => sum + (g.feeUSD ?? 0), 0);
  const confirmations = runnable.reduce((sum, g) => sum + g.confirmations, 0);
  const done = groups.flatMap((g) => g.steps).filter((s) => s.state === 'done').length;
  const close = () => {
    if (phase === 'running') return;
    abort.current.abort();
    onClose([...touched.current]);
  };

  return (
    <div className="br-modal" role="dialog" aria-label="Revoke approvals" onMouseDown={close}>
      <div className="br-modal__panel br-exec ap-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="br-modal__head">
          <h3>
            Revoke {approvals.length} approval{approvals.length === 1 ? '' : 's'} on {groups.length} network
            {groups.length === 1 ? '' : 's'}
          </h3>
          <button type="button" className="br-icon-btn" aria-label="Close" disabled={phase === 'running'} onClick={close}>
            ×
          </button>
        </div>

        {groups.map((g) => (
          <div key={g.key} className="ap-panel__group">
            <div className="ap-panel__head">
              <strong>{g.chainName}</strong>
              <span className="br-muted">
                {!g.prepared
                  ? 'checking…'
                  : g.blocker
                    ? ''
                    : `${g.confirmations} confirmation${g.confirmations === 1 ? '' : 's'} · fee ≈ ${g.fee ?? '?'}${
                        g.feeUSD != null ? ` (${formatUSD(g.feeUSD)})` : ''
                      }`}
              </span>
            </div>
            {g.blocker && (
              <div className="br-warn">
                {g.blocker}
                {g.needsWallet && phase === 'review' && (
                  <>
                    {' '}
                    <button type="button" className="br-link" onClick={() => void connectFor(g)}>
                      Connect
                    </button>
                  </>
                )}
              </div>
            )}
            <ol className="br-exec__steps">
              {g.steps.map((s, i) => (
                <li key={i} className={`is-${s.state}`}>
                  <span>{s.label}</span>
                  <span className="br-muted">{STATE_LABELS[s.state]}</span>
                  {s.hash && (
                    <button type="button" className="br-link" onClick={() => openExternal(txUrl(g.family, g.chainId, s.hash!))}>
                      transaction ↗
                    </button>
                  )}
                  {s.detail && <span className={s.state === 'done' ? 'br-muted' : 'br-warn'}>{s.detail}</span>}
                </li>
              ))}
            </ol>
          </div>
        ))}

        <div className="br-exec__sim">
          {phase === 'review' &&
            (allPrepared
              ? runnable.length
                ? `Your wallet will ask ${confirmations} time${confirmations === 1 ? '' : 's'} (fewer if it can batch). ` +
                  `Network fees ≈ ${formatUSD(totalUSD)}; CoinMan charges nothing. Each transaction only takes access away — it cannot move funds.`
                : 'Nothing here can be revoked right now — see the notes above.'
              : 'Checking each revoke against the live networks…')}
          {phase === 'running' && 'Keep the wallet app open and confirm each request. Networks go one after another.'}
          {phase === 'finished' && `Finished: ${done} revoked. Close to scan the networks again.`}
        </div>

        <div className="br-exec__actions">
          {phase === 'review' && (
            <>
              <button type="button" className="br-btn br-btn--ghost" onClick={close}>
                Cancel
              </button>
              <button type="button" className="br-btn br-btn--primary" disabled={!allPrepared || !runnable.length} onClick={() => void start()}>
                Start revoking
              </button>
            </>
          )}
          {phase === 'running' && (
            <button type="button" className="br-btn br-btn--ghost" onClick={() => (stop.current = true)}>
              Stop after the current one
            </button>
          )}
          {phase === 'finished' && (
            <button type="button" className="br-btn br-btn--primary" onClick={close}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

import { Approval, RiskLevel, RiskReason } from './types';

/**
 * How dangerous an approval is, with the reasons in plain words.
 *
 * - high: whoever holds a key can take the tokens (approval to a plain
 *   account), or the explorer flags the spender as a scam;
 * - medium: the contract's code is not published; unlimited access to a
 *   contract outside CoinMan's list that has not been touched for a year;
 *   a whole NFT collection open to such a contract; any Solana delegate;
 * - low: the rest (known protocols, limited amounts, nothing to take).
 *
 * "Select risky" picks high and medium.
 */

const YEAR_S = 365 * 24 * 3600;
/** From this size on an allowance counts as unlimited (covers MaxUint96/160/256). */
export const UNLIMITED = 2n ** 96n - 1n;

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
export const isRisky = (a: Pick<Approval, 'risk'>) => a.risk !== 'low';

type Draft = Omit<Approval, 'risk' | 'reasons'>;

export function assessRisk(a: Draft, nowS = Math.floor(Date.now() / 1000)): { risk: RiskLevel; reasons: RiskReason[] } {
  const reasons: RiskReason[] = [];
  const s = a.spenderInfo;
  const nft = a.kind === 'nft-all' || a.kind === 'nft-token';

  if (s.scam) reasons.push({ level: 'high', text: 'The explorer flags this address as a scam' });
  if (s.type === 'account') {
    reasons.push({
      level: 'high',
      text:
        a.family === 'SVM'
          ? 'The delegate is an ordinary wallet — whoever holds its key can move these tokens'
          : 'Approved to a plain account, not a contract — whoever holds its key can take the tokens',
    });
  }
  if (s.type === 'contract' && s.verified === false) {
    reasons.push({ level: 'medium', text: 'The contract’s source code is not published' });
  }
  if (a.family === 'SVM' && s.type !== 'account') {
    reasons.push({ level: 'medium', text: 'A delegate can move these tokens without asking you' });
  }
  if (a.kind === 'nft-all') {
    reasons.push(
      s.known
        ? { level: 'low', text: 'Access to the whole collection' }
        : { level: 'medium', text: 'Can take every NFT of this collection you hold' }
    );
  }
  if (a.unlimited && !nft) reasons.push({ level: 'low', text: 'Unlimited amount' });
  const old = a.lastChange != null && nowS - a.lastChange > YEAR_S;
  if (old && !s.known && (a.unlimited || a.kind === 'nft-all') && s.type === 'contract') {
    reasons.push({ level: 'medium', text: 'Unlimited, and not touched for over a year' });
  }
  if (s.known) reasons.push({ level: 'low', text: `Known protocol: ${s.name}` });
  if (a.kind === 'permit2') {
    reasons.push({ level: 'low', text: 'Works only while the token is also approved to Permit2' });
  }
  if (a.expiration != null && a.expiration > 0) {
    const days = Math.max(0, Math.round((a.expiration - nowS) / 86400));
    reasons.push({ level: 'low', text: days > 3650 ? 'Does not expire' : `Expires in ${days} day${days === 1 ? '' : 's'}` });
  }

  let risk: RiskLevel = reasons.reduce<RiskLevel>((max, r) => (RANK[r.level] > RANK[max] ? r.level : max), 'low');

  // Nothing to lose today: an unknown token or a collection the wallet holds none of.
  const holdsNone = a.balance === 0n;
  if (holdsNone && (nft || !a.listed)) {
    reasons.push({
      level: 'low',
      text: nft ? 'You hold none of this collection' : 'Unknown token, and you hold none — nothing to take',
    });
    risk = 'low';
  }
  return { risk, reasons };
}

/** The value the spender could take today, in USD; undefined when it cannot be priced. */
export function valueAtRisk(a: Pick<Approval, 'kind' | 'amount' | 'balance' | 'priceUSD' | 'decimals'>): number | undefined {
  if (a.kind === 'nft-all' || a.kind === 'nft-token') return undefined;
  if (a.balance == null || !a.priceUSD || a.decimals == null) return undefined;
  const exposed = a.amount != null && a.amount < a.balance ? a.amount : a.balance;
  return (Number(exposed) / 10 ** a.decimals) * a.priceUSD;
}

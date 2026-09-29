import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityAction, ActivityFilters } from '../../holdingsApi';
import { YearnVault } from '../../types';
import {
  ACTIVITY_TYPES,
  activityLabels,
  activityMatchesSearch,
  chainName,
  findChain,
  findListedVault,
  isZapEntry,
} from '../../activity';
import { useActivity, useActivityChainIds, useKongVaultIndex } from '../../hooks/useActivity';
import { YearnMark } from '../../assets/YearnLogo';
import { CalendarIcon, Check, ChevronDown, Close, Search as SearchIcon } from '../ui/icons';
import { ActivityChip, ActivityRow } from '../activity/ActivityRow';

/** `YYYY-MM-DD`, local calendar days as picked in the date inputs. */
interface DateRange {
  start?: string;
  end?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');
const toDayString = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};
const formatDay = (day: string) =>
  parseDay(day).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
/** Local calendar day of an entry — what its date chip filters on. */
const dayOfTimestamp = (timestamp: number) => toDayString(new Date(timestamp * 1000));

/** Local 00:00:00 to 23:59:59, as yearn.fi sends it; an end of "today" is left open. */
function rangeToTimestamps(range: DateRange): Pick<ActivityFilters, 'startTimestamp' | 'endTimestamp'> {
  const out: Pick<ActivityFilters, 'startTimestamp' | 'endTimestamp'> = {};
  if (range.start) out.startTimestamp = Math.floor(parseDay(range.start).getTime() / 1000);
  if (range.end && range.end !== toDayString(new Date())) {
    const end = parseDay(range.end);
    end.setHours(23, 59, 59, 0);
    out.endTimestamp = Math.floor(end.getTime() / 1000);
  }
  return out;
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);
  return ref;
}

const TypeFilter: React.FC<{
  selected: ActivityAction[];
  onChange: (next: ActivityAction[]) => void;
}> = ({ selected, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useDismiss(isOpen, () => setIsOpen(false));
  const label = selected.length
    ? ACTIVITY_TYPES.filter((type) => selected.includes(type.id))
        .map((type) => type.label)
        .join(', ')
    : 'Transaction type';

  return (
    <div className="y-act-filter" ref={ref}>
      <button
        type="button"
        className={`y-act-filter__btn${selected.length ? ' is-active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="y-act-filter__label">{label}</span>
        {selected.length > 0 && <span className="y-filters-badge">{selected.length}</span>}
        <ChevronDown size={16} />
      </button>
      {isOpen && (
        <div className="y-act-menu" role="listbox" aria-multiselectable="true">
          {ACTIVITY_TYPES.map((type) => {
            const isOn = selected.includes(type.id);
            return (
              <button
                key={type.id}
                type="button"
                role="option"
                aria-selected={isOn}
                className={`y-act-menu__item${isOn ? ' is-active' : ''}`}
                onClick={() =>
                  onChange(isOn ? selected.filter((id) => id !== type.id) : [...selected, type.id])
                }
              >
                <span className="y-act-menu__check">{isOn && <Check size={12} />}</span>
                {type.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DateRangeFilter: React.FC<{
  range: DateRange;
  onChange: (next: DateRange) => void;
}> = ({ range, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(range);
  const ref = useDismiss(isOpen, () => setIsOpen(false));
  const today = toDayString(new Date());
  const isSet = Boolean(range.start || range.end);

  const label = isSet
    ? `${range.start ? formatDay(range.start) : '…'} – ${range.end ? formatDay(range.end) : 'Today'}`
    : 'Select date range';

  const save = () => {
    // yearn.fi swaps a start that lands after the end instead of rejecting it.
    const { start, end } = draft;
    onChange(start && end && start > end ? { start: end, end: start } : draft);
    setIsOpen(false);
  };

  return (
    <div className="y-act-filter" ref={ref}>
      <button
        type="button"
        className={`y-act-filter__btn${isSet ? ' is-active' : ''}`}
        aria-expanded={isOpen}
        onClick={() => {
          setDraft(range);
          setIsOpen((open) => !open);
        }}
      >
        <CalendarIcon size={16} />
        <span className="y-act-filter__label">{label}</span>
      </button>
      {isOpen && (
        <div className="y-act-menu y-act-dates" role="dialog" aria-label="Date range">
          <p className="y-act-dates__title">Date range</p>
          <label className="y-act-dates__field">
            <span>Start date</span>
            <input
              type="date"
              max={today}
              value={draft.start ?? ''}
              onChange={(event) => setDraft((prev) => ({ ...prev, start: event.target.value || undefined }))}
            />
          </label>
          <label className="y-act-dates__field">
            <span>End date</span>
            <input
              type="date"
              max={today}
              value={draft.end ?? ''}
              onChange={(event) => setDraft((prev) => ({ ...prev, end: event.target.value || undefined }))}
            />
          </label>
          <div className="y-act-dates__actions">
            <button
              type="button"
              className="y-btn y-btn--ghost"
              onClick={() => {
                onChange({});
                setIsOpen(false);
              }}
            >
              Clear
            </button>
            <button type="button" className="y-btn y-btn--light" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface PortfolioActivityProps {
  address: string;
  vaults: YearnVault[];
  onSelectVault: (vault: YearnVault) => void;
}

/** Port of yearn.fi's `PortfolioActivitySection`. */
export const PortfolioActivity: React.FC<PortfolioActivityProps> = ({
  address,
  vaults,
  onSelectVault,
}) => {
  const [chainId, setChainId] = useState<number | null>(null);
  const [types, setTypes] = useState<ActivityAction[]>([]);
  const [range, setRange] = useState<DateRange>({});
  const [search, setSearch] = useState('');
  const [zapOnly, setZapOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // The API takes one type; with several selected it returns all and the
  // list is narrowed here.
  const filters = useMemo<ActivityFilters>(
    () => ({
      type: types.length === 1 ? types[0] : undefined,
      chainId: chainId ?? undefined,
      ...rangeToTimestamps(range),
    }),
    [types, chainId, range]
  );

  const activity = useActivity(address, filters);
  const facets = useActivityChainIds(address);
  const kong = useKongVaultIndex();

  const rows = useMemo(() => {
    const entries = activity.data?.pages.flatMap((page) => page.entries) ?? [];
    return entries
      .map((entry, index) => ({
        entry,
        labels: activityLabels(entry, kong.data),
        key: `${entry.chainId}:${entry.txHash}:${entry.vaultAddress}:${index}`,
      }))
      .filter(({ entry, labels }) => {
        if (types.length > 1 && !types.includes(entry.action)) return false;
        if (zapOnly && !isZapEntry(entry)) return false;
        return activityMatchesSearch(entry, labels, search);
      });
  }, [activity.data, kong.data, types, zapOnly, search]);

  const loadedCount = activity.data?.pages.reduce((sum, page) => sum + page.entries.length, 0) ?? 0;
  const hasFilters =
    chainId !== null || types.length > 0 || Boolean(range.start || range.end) || Boolean(search) || zapOnly;

  const chainIds = useMemo(() => {
    const ids = new Set<number>(facets.data ?? []);
    activity.data?.pages.forEach((page) => page.entries.forEach((entry) => ids.add(entry.chainId)));
    if (chainId !== null) ids.add(chainId);
    return [...ids].sort((a, b) => a - b);
  }, [facets.data, activity.data, chainId]);

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (activity.isLoading) {
    return (
      <div className="y-pf-loading">
        <span className="y-pf-loading__spinner" />
        Loading activity...
      </div>
    );
  }

  if (activity.isError) {
    return (
      <div className="y-act-state">
        <p className="y-act-state__error">Error loading activity</p>
        <span>{activity.error instanceof Error ? activity.error.message : String(activity.error)}</span>
      </div>
    );
  }

  if (loadedCount === 0 && !hasFilters) {
    return <div className="y-act-state">No transactions to show.</div>;
  }

  return (
    <section className="y-act">
      <div className="y-act-filters">
        <div className="y-segmented" role="group" aria-label="Chains">
          <button
            type="button"
            className={`y-segmented__item${chainId === null ? ' is-active' : ''}`}
            aria-pressed={chainId === null}
            onClick={() => setChainId(null)}
          >
            <YearnMark size={16} />
            All Chains
          </button>
          {chainIds.map((id) => {
            const isActive = chainId === id;
            const chain = findChain(id);
            return (
              <button
                key={id}
                type="button"
                className={`y-segmented__item y-segmented__item--icon${isActive ? ' is-active' : ''}`}
                aria-pressed={isActive}
                aria-label={chainName(id)}
                title={chainName(id)}
                onClick={() => setChainId(isActive ? null : id)}
              >
                {chain && <img className="y-chain-icon" src={chain.icon} alt="" loading="lazy" />}
                <span className="y-segmented__item-label">{chainName(id)}</span>
              </button>
            );
          })}
        </div>

        <TypeFilter selected={types} onChange={setTypes} />
        <DateRangeFilter range={range} onChange={setRange} />

        <div className="y-search y-act-search">
          <input
            className="y-search__input"
            type="text"
            placeholder="Search activity"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="y-search__clear"
              aria-label="Clear search"
              onClick={() => setSearch('')}
            >
              <Close size={14} />
            </button>
          )}
          <span className="y-search__icon" aria-hidden="true">
            <SearchIcon size={16} />
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="y-act-state">
          {hasFilters ? 'No activity matches these filters.' : 'No activity to show.'}
        </div>
      ) : (
        <div className="y-act-list">
          {rows.map(({ entry, labels, key }) => {
            const day = dayOfTimestamp(entry.timestamp);
            const onChip = (chip: ActivityChip) => {
              if (chip === 'vault') setSearch(search === labels.vaultName ? '' : labels.vaultName);
              else if (chip === 'chain') setChainId(chainId === entry.chainId ? null : entry.chainId);
              else if (chip === 'date') {
                setRange(range.start === day && range.end === day ? {} : { start: day, end: day });
              } else setZapOnly((on) => !on);
            };
            return (
              <ActivityRow
                key={key}
                entry={entry}
                labels={labels}
                listedVault={findListedVault(entry, vaults)}
                isExpanded={expanded.has(key)}
                onToggle={() => toggleExpanded(key)}
                onSelectVault={onSelectVault}
                activeChips={{
                  vault: search === labels.vaultName,
                  chain: chainId === entry.chainId,
                  date: range.start === day && range.end === day,
                  zap: zapOnly,
                }}
                onChip={onChip}
              />
            );
          })}
        </div>
      )}

      {activity.hasNextPage && (
        <button
          type="button"
          className="y-btn y-btn--ghost y-act-more"
          disabled={activity.isFetchingNextPage}
          onClick={() => activity.fetchNextPage()}
        >
          {activity.isFetchingNextPage ? 'Loading more...' : 'Load more'}
        </button>
      )}
    </section>
  );
};

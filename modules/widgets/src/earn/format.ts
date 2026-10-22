/** Number/date formatting that reproduces yearn.fi output exactly.
 *
 * The site rounds to 3 significant digits but never shows more than
 * 2 decimals and never fewer than 2 for values it keeps precision on
 * (verified against the live list: 8.46%, 11.8%, 6.10%, 0.03%,
 *  $19.7M, $1.00M, $478K).  Intl's `roundingPriority: 'lessPrecision'`
 * reproduces that rule with a single configuration.
 *
 * Formatters depend on the UI language (`intlLocale()`), so they are built
 * lazily and cached per locale - never at module load.
 */

import { intlLocale, tr } from './i18n';

type RoundingOptions = Intl.NumberFormatOptions & {
  roundingPriority?: 'auto' | 'morePrecision' | 'lessPrecision';
};

const yearnRounding: RoundingOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  minimumSignificantDigits: 1,
  maximumSignificantDigits: 3,
  roundingPriority: 'lessPrecision',
};

interface Formatters {
  compact: Intl.NumberFormat;
  plain: Intl.NumberFormat;
  whole: Intl.NumberFormat;
  cents: Intl.NumberFormat;
  tooltipDate: Intl.DateTimeFormat;
  longDate: Intl.DateTimeFormat;
}

const formatterCache = new Map<string, Formatters>();

function fmts(): Formatters {
  const locale = intlLocale();
  let f = formatterCache.get(locale);
  if (!f) {
    const dateOptions: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
    f = {
      compact: new Intl.NumberFormat(locale, { notation: 'compact', ...yearnRounding }),
      plain: new Intl.NumberFormat(locale, yearnRounding),
      whole: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
      cents: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      tooltipDate: new Intl.DateTimeFormat(locale, dateOptions),
      longDate: new Intl.DateTimeFormat(locale, dateOptions),
    };
    formatterCache.set(locale, f);
  }
  return f;
}

/** Decimal separator of the current locale (`.` for en, `,` for ru). */
function decimalSeparator(): string {
  return intlLocale().startsWith('ru') ? ',' : '.';
}

/** Swaps the `.` of a plain JS number string for the locale's decimal separator. */
export function localizeDecimal(text: string): string {
  const sep = decimalSeparator();
  return sep === '.' ? text : text.replace('.', sep);
}

/** `$9.28M`, `$478K`, `$0.00` */
export function formatUSD(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '$0.00';
  if (num === 0) return `$${localizeDecimal('0.00')}`;
  if (Math.abs(num) < 1000) return `$${fmts().plain.format(num)}`;
  return `$${fmts().compact.format(num)}`;
}

/** TVL as yearn.fi prints it: `$19.7M` from $10K, `$5,192` from $100, `$95.12` below. */
export function formatTVL(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return `$${localizeDecimal('0.00')}`;
  if (Math.abs(num) >= 10_000) return `${fmts().compact.format(num)}`;
  if (Math.abs(num) >= 100) return `${fmts().whole.format(num)}`;
  return `${fmts().plain.format(num)}`;
}

/** `$5,519,192` - used in the strategy donut legend and tooltips. */
export function formatUSDFull(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '$0';
  return `$${fmts().whole.format(num)}`;
}

/** `$2,030,246.13` - portfolio metrics and history tooltips. */
export function formatUSDCents(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return `$${localizeDecimal('0.00')}`;
  return `${num < 0 ? '-' : ''}$${fmts().cents.format(Math.abs(num))}`;
}

/** Accepts a ratio (0.0846) and prints `8.46%`; yearn.fi caps the display at `\u2265 500%`. */
export function formatAPY(ratio: number | null | undefined): string {
  const num = Number(ratio || 0);
  if (!Number.isFinite(num) || num === 0) return `${localizeDecimal('0.00')}%`;
  if (num >= 5) return '\u2265 500%';
  return `${fmts().plain.format(num * 100)}%`;
}

/** Accepts a percentage value already scaled to 0..100. */
export function formatPercent(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return `${localizeDecimal('0.00')}%`;
  return `${fmts().plain.format(num)}%`;
}

/** Fees are shown as whole percents on the site: `0%`, `10%`, `20%`. */
export function formatFeePercent(ratio: number | null | undefined): string {
  const num = Number(ratio || 0);
  const scaled = num > 1 ? num : num * 100;
  return `${localizeDecimal(String(Math.round(scaled * 100) / 100))}%`;
}

/** Token amounts: `1,234.56`, `0.0001`, `0` */
export function formatAmount(value: number | null | undefined, maxDecimals = 4): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return '0';
  return new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
}

/** Converts a raw on-chain amount to a display string without precision loss. */
export function formatUnitsDisplay(
  raw: bigint | null | undefined,
  decimals: number,
  maxDecimals = 4
): string {
  if (raw === null || raw === undefined) return '0';
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, maxDecimals);
  const trimmed = fractionStr.replace(/0+$/, '');
  const wholeStr = new Intl.NumberFormat(intlLocale()).format(whole);
  return `${negative ? '-' : ''}${wholeStr}${trimmed ? `${decimalSeparator()}${trimmed}` : ''}`;
}

/** Price per share is shown with 6 decimals: `1.027994`. */
export function formatPPS(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return localizeDecimal('0.000000');
  return localizeDecimal(num.toFixed(6));
}

export function shortenAddress(address?: string | null, lead = 6, tail = 4): string {
  if (!address) return '';
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}\u2026${address.slice(-tail)}`;
}

/** `July 28, 2026` - chart tooltips. */
export function formatTooltipDate(timestampMs: number): string {
  return fmts().tooltipDate.format(new Date(timestampMs));
}

/** `January 20, 2026` - "Deployed on". */
export function formatLongDate(timestampMs: number): string {
  return fmts().longDate.format(new Date(timestampMs));
}

/** `07/28/26` (en) / `28.07.26` (ru) - chart axis ticks. */
export function formatAxisDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const yy = String(d.getFullYear()).slice(-2);
  return intlLocale().startsWith('ru') ? `${dd}.${mm}.${yy}` : `${mm}/${dd}/${yy}`;
}

/** `07/26` (en) / `07.26` (ru) - chart axis ticks on long ranges. */
export function formatAxisMonth(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sep = intlLocale().startsWith('ru') ? '.' : '/';
  return `${pad(d.getMonth() + 1)}${sep}${String(d.getFullYear()).slice(-2)}`;
}

/** Countdown text for the yvUSD cooldown: `13d 4h`, `4h 12m`, `Less than a minute`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return tr('Less than a minute');
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return hours > 0 ? tr('{days}d {hours}h', { days, hours }) : tr('{days}d', { days });
  }
  if (hours > 0) {
    return minutes > 0 ? tr('{hours}h {minutes}m', { hours, minutes }) : tr('{hours}h', { hours });
  }
  return minutes > 0 ? tr('{minutes}m', { minutes }) : tr('Less than a minute');
}

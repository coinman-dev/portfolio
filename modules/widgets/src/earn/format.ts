/** Number/date formatting that reproduces yearn.fi output exactly.
 *
 * The site rounds to 3 significant digits but never shows more than
 * 2 decimals and never fewer than 2 for values it keeps precision on
 * (verified against the live list: 8.46%, 11.8%, 6.10%, 0.03%,
 *  $19.7M, $1.00M, $478K).  Intl's `roundingPriority: 'lessPrecision'`
 * reproduces that rule with a single configuration.
 */

const LOCALE = 'en-US';

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

const compactFormatter = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  ...yearnRounding,
});

const plainFormatter = new Intl.NumberFormat(LOCALE, yearnRounding);

const wholeFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** `$9.28M`, `$478K`, `$0.00` */
export function formatUSD(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '$0.00';
  if (num === 0) return '$0.00';
  if (Math.abs(num) < 1000) return `$${plainFormatter.format(num)}`;
  return `$${compactFormatter.format(num)}`;
}

/** `$5,519,192` — used in the strategy donut legend and tooltips. */
export function formatUSDFull(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '$0';
  return `$${wholeFormatter.format(num)}`;
}

/** Accepts a ratio (0.0846) and prints `8.46%`. */
export function formatAPY(ratio: number | null | undefined): string {
  const num = Number(ratio || 0);
  if (!Number.isFinite(num) || num === 0) return '0.00%';
  return `${plainFormatter.format(num * 100)}%`;
}

/** Accepts a percentage value already scaled to 0..100. */
export function formatPercent(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return '0.00%';
  return `${plainFormatter.format(num)}%`;
}

/** Fees are shown as whole percents on the site: `0%`, `10%`, `20%`. */
export function formatFeePercent(ratio: number | null | undefined): string {
  const num = Number(ratio || 0);
  const scaled = num > 1 ? num : num * 100;
  return `${Math.round(scaled * 100) / 100}%`;
}

/** Token amounts: `1,234.56`, `0.0001`, `0` */
export function formatAmount(value: number | null | undefined, maxDecimals = 4): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return '0';
  return new Intl.NumberFormat(LOCALE, {
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
  const wholeStr = new Intl.NumberFormat(LOCALE).format(whole);
  return `${negative ? '-' : ''}${wholeStr}${trimmed ? `.${trimmed}` : ''}`;
}

/** Price per share is shown with 6 decimals: `1.027994`. */
export function formatPPS(value: number | null | undefined): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0.000000';
  return num.toFixed(6);
}

export function shortenAddress(address?: string | null, lead = 6, tail = 4): string {
  if (!address) return '';
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

const tooltipDate = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const longDate = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

/** `July 28, 2026` — chart tooltips. */
export function formatTooltipDate(timestampMs: number): string {
  return tooltipDate.format(new Date(timestampMs));
}

/** `January 20, 2026` — "Deployed on". */
export function formatLongDate(timestampMs: number): string {
  return longDate.format(new Date(timestampMs));
}

/** `07/28/26` — chart axis ticks. */
export function formatAxisDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(-2)}`;
}

/** `07/26` — chart axis ticks on long ranges. */
export function formatAxisMonth(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

/** Countdown text for the yvUSD cooldown: `13d 4h`, `4h 12m`, `Less than a minute`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Less than a minute';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return minutes > 0 ? `${minutes}m` : 'Less than a minute';
}

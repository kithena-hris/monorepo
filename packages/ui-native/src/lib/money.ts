/**
 * Money, formatted without ever becoming a float.
 *
 * The web's `Money` hands `Intl.NumberFormat` a decimal string, which the
 * browser formats exactly. A phone's engine is not held to that (Hermes may
 * read the string as a double, and 9,007,199,254,740.99 does not survive one),
 * so here `Intl` only describes the locale: it formats a harmless sample
 * amount into parts, and the real digits, moved by string arithmetic from
 * minor units, are dropped into that shape. Grouping, separators, the symbol
 * and where it sits all come from the locale; the figures never touch a
 * `number`.
 */

export type MoneyFormat = {
  /** Minor-unit exponent. Defaults to the currency's own (2 for EUR, 0 for JPY). */
  exponent?: number | undefined;
  locale?: string | undefined;
  /** No symbol, for a column already headed with the currency. */
  hideCurrency?: boolean | undefined;
  /** `code` where several currencies share a column. */
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name' | undefined;
  /** Brackets instead of a minus, `(€1,240.50)`, for a ledger. */
  accounting?: boolean | undefined;
};

/** The currency's own number of minor-unit digits. */
export function currencyExponent(currency: string, locale?: string): number {
  return (
    new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Shifts an integer string right by `exponent` places. No floating point. */
export function minorUnitsToDecimalString(minorUnits: string | bigint, exponent: number): string {
  const raw = typeof minorUnits === 'bigint' ? minorUnits.toString() : minorUnits.trim();
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) {
    throw new TypeError(`Money expects an integer string in minor units, received "${raw}".`);
  }
  if (exponent === 0) return negative ? `-${digits}` : digits;
  const padded = digits.padStart(exponent + 1, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

const NUMERIC = new Set(['integer', 'group', 'decimal', 'fraction']);

/**
 * `minorUnits` of `currency`, formatted for the locale, with a true minus
 * sign: the width of a figure, on the figures' midline, so a column of signed
 * amounts still lines up.
 */
export function formatMoney(
  minorUnits: string | bigint,
  currency: string,
  {
    exponent,
    locale,
    hideCurrency = false,
    currencyDisplay = 'symbol',
    accounting = false,
  }: MoneyFormat = {},
): string {
  const places = exponent ?? currencyExponent(currency, locale);
  const decimal = minorUnitsToDecimalString(minorUnits, places);
  const negative = decimal.startsWith('-') && /[1-9]/.test(decimal);
  const [whole = '0', fraction = ''] = decimal.replace('-', '').split('.');

  const format = new Intl.NumberFormat(locale, {
    style: hideCurrency ? 'decimal' : 'currency',
    currency,
    currencyDisplay,
    currencySign: accounting ? 'accounting' : 'standard',
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  // A sample in the locale's shape: seven integer digits show its grouping.
  const parts = format.formatToParts(negative ? -1234567 : 1234567);
  const group = parts.find((p) => p.type === 'group')?.value ?? '';
  const point = parts.find((p) => p.type === 'decimal')?.value ?? '.';

  let grouped = '';
  for (let i = 0; i < whole.length; i += 1) {
    const left = whole.length - i;
    grouped += whole[i] ?? '';
    if (left > 1 && (left - 1) % 3 === 0) grouped += group;
  }
  const figures = fraction ? `${grouped}${point}${fraction}` : grouped;

  let out = '';
  let placed = false;
  for (const part of parts) {
    if (NUMERIC.has(part.type)) {
      if (!placed) out += figures;
      placed = true;
    } else if (part.type === 'minusSign') out += '−';
    else out += part.value;
  }
  return out;
}

/** Whether an amount in minor units is below zero. */
export function isNegative(minorUnits: string | bigint): boolean {
  const raw = typeof minorUnits === 'bigint' ? minorUnits.toString() : minorUnits.trim();
  return raw.startsWith('-') && /[1-9]/.test(raw);
}

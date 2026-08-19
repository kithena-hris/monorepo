import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * Renders an amount held in minor units.
 *
 * Money crosses the wire as an integer string in minor units, and it must not
 * become a float on the way to the screen either. `Number('20000000000.15')`
 * is already wrong before it reaches the formatter. `Intl.NumberFormat`
 * accepts a decimal *string* and formats it exactly, so the conversion here is
 * string arithmetic and nothing else.
 *
 * Presentation only: this component neither adds, converts, nor rounds. If two
 * amounts need summing, sum them in the domain with `decimal.js` and pass the
 * result.
 */

/**
 * Intl.NumberFormat V3 accepts a decimal string.
 *
 * `format()` has taken `string` since the ECMA-402 V3 proposal shipped, which
 * every browser and Node version this product supports has had for years. The
 * TypeScript DOM lib still describes only `number | bigint`, so the platform is
 * ahead of its own types and this states the truth once.
 *
 * It replaces `format(decimal as unknown as number)`, a double assertion that
 * said "trust me" twice and, worse, described the value as a `number` when the
 * whole point is that it is *not* one: money is carried as a decimal string
 * precisely so it never goes near a float. A cast renaming it `number`
 * documented the opposite of the invariant it existed to protect.
 *
 * Declared here rather than in an ambient `.d.ts`. Apps compile this package
 * from source, so a separate declaration file would be in this package's own
 * program and in nobody else's, and every consumer would fail on the line
 * below. Co-located, it travels with the one call site that needs it.
 *
 * Widening rather than replacing, so `number` and `bigint` still check.
 */
declare global {
  /*
   * `namespace` is not a stylistic choice here: augmenting an existing ambient
   * namespace is the only syntax that can add an overload to a lib type, and
   * ES module syntax has no equivalent. The rule is off for this block alone.
   */
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Intl {
    interface NumberFormat {
      format(value: number | bigint | string): string;
    }
  }
}

export interface MoneyProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** Integer amount in minor units, e.g. `"420050"` for 4 200.50. */
  minorUnits: string | bigint;
  /** ISO 4217 code, e.g. `"EUR"`. */
  currency: string;
  /** Minor-unit exponent. Defaults to the currency's own (2 for EUR, 0 for JPY). */
  exponent?: number;
  locale?: string | undefined;
  /** Drop the currency symbol, for a column already headed with the currency. */
  hideCurrency?: boolean;
  /** Colour negatives in the danger tone. Off by default; a refund is not an error. */
  signColored?: boolean;
}

function currencyExponent(currency: string, locale: string | undefined): number {
  const { maximumFractionDigits } = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).resolvedOptions();
  // Every ISO 4217 code resolves to a digit count; the type is optional only
  // because the same options bag serves non-currency formats.
  return maximumFractionDigits ?? 2;
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
  const whole = padded.slice(0, padded.length - exponent);
  const fraction = padded.slice(padded.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function Money({
  minorUnits,
  currency,
  exponent,
  locale,
  hideCurrency = false,
  signColored = false,
  className,
  ...props
}: MoneyProps): JSX.Element {
  const places = exponent ?? currencyExponent(currency, locale);
  const decimal = minorUnitsToDecimalString(minorUnits, places);
  const formatted = new Intl.NumberFormat(locale, {
    style: hideCurrency ? 'decimal' : 'currency',
    currency,
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    // Intl.NumberFormat V3 formats decimal strings exactly, which is what keeps
    // a 19-digit payroll figure exact where a float would not. The DOM lib is
    // behind the platform here; `src/types/intl-number-format-v3.d.ts` corrects
    // it once so this call site needs no cast.
  }).format(decimal);

  const negative = decimal.startsWith('-');

  return (
    <span
      data-numeric
      className={cn('tabular-nums', signColored && negative && 'text-danger-fg', className)}
      {...props}
    >
      {formatted}
    </span>
  );
}

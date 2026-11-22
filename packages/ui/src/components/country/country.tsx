import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';
import { regionName } from '../../lib/intl';

const CODE = /^[A-Za-z]{2}$/u;

/**
 * A country's flag from its ISO 3166-1 alpha-2 code, or '' for anything else.
 *
 * ponytail: the flag is the platform's emoji (two regional indicators), so it
 * costs no assets and follows the reader's system. Windows draws the two
 * letters instead of a flag, which still reads as the country's code. Ship
 * SVG flags as a Reach asset set if a flag must look the same everywhere.
 */
export function countryFlag(code: string): string {
  if (!CODE.test(code)) return '';
  const upper = code.toUpperCase();
  // A regional indicator per letter: A is U+1F1E6.
  return String.fromCodePoint(
    0x1f1e6 + upper.charCodeAt(0) - 65,
    0x1f1e6 + upper.charCodeAt(1) - 65,
  );
}

export interface CountryProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** ISO 3166-1 alpha-2: `DE`, `us`. Anything else is shown as written, with no flag. */
  code: string;
  /**
   * `name` is the flag and the country's name in the reader's language.
   * `code` is the flag and the code, for a tight column. `flag` is the flag
   * alone, named for a screen reader.
   */
  display?: 'name' | 'code' | 'flag';
  /**
   * How the flag is drawn. `plain` is the flag as the system draws it.
   * `rounded` crops it to a circle, the size of a small avatar beside a name.
   * `boxed` sets it on a small tile, so flags of different outlines line up
   * down a column.
   */
  shape?: 'plain' | 'rounded' | 'boxed';
}

/**
 * The flag in its shape. Rounded, the emoji is drawn larger than its circle
 * and cropped to its middle; where a system draws letters for a flag, they
 * are kept at their own size so both stay inside it.
 */
const FLAG = {
  plain: 'shrink-0 leading-none',
  rounded:
    'inline-flex size-[1.25em] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-sunken leading-none [&>span]:text-[1.7em]',
  boxed:
    'inline-flex h-[1.375em] w-[1.75em] shrink-0 items-center justify-center rounded-sm border border-border bg-surface-sunken leading-none',
} as const;

/**
 * A country: its flag and its name in the reader's language.
 *
 * The name comes from the platform (`Intl.DisplayNames`), so nobody keeps a
 * list of countries, and "Germany" is "Allemagne" on a French page.
 */
export function Country({
  code,
  display = 'name',
  shape = 'plain',
  className,
  ...props
}: CountryProps): JSX.Element {
  const known = CODE.test(code);
  const upper = code.toUpperCase();
  const name = known ? regionName(upper) : code;
  const flag = countryFlag(code);
  if (display === 'flag' && flag !== '') {
    return (
      <span role="img" aria-label={name} className={cn(FLAG[shape], className)} {...props}>
        <span aria-hidden>{flag}</span>
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)} {...props}>
      {flag === '' ? null : (
        <span aria-hidden className={FLAG[shape]}>
          <span>{flag}</span>
        </span>
      )}
      {display === 'code' && known ? (
        // The code is what is drawn; the name is what is read.
        <>
          <span aria-hidden className="tabular-nums">
            {upper}
          </span>
          <span className="sr-only">{name}</span>
        </>
      ) : (
        <span className="truncate">{name}</span>
      )}
    </span>
  );
}

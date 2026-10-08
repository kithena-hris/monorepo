/**
 * A number as a locale writes it, and back. Pure, so it is tested without a
 * device. `null` is empty, which is a different fact from zero.
 */

import { numberParts } from '../../lib/intl-parts.ts';

function separators(locale: string | undefined): { group: string; decimal: string } {
  const parts = numberParts(new Intl.NumberFormat(locale), 12345.6);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
}

/** `0.8` as `0,8` in German, `92000` as `92 000,00` in French with two places. */
export function formatNumber(value: number | null, locale?: string, precision?: number): string {
  if (value === null) return '';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision ?? 0,
    maximumFractionDigits: precision ?? 20,
  }).format(value);
}

/**
 * What someone typed, as a number: the locale's grouping dropped, its decimal
 * mark read as one, a true minus accepted. Empty is `null`, never 0; so is
 * anything that is not a number.
 */
export function parseNumber(input: string, locale?: string): number | null {
  const { group, decimal } = separators(locale);
  // Spaces of every width group digits somewhere; none of them is a digit.
  let text = input.replace(/[\s  ]/g, '').replace(/−/g, '-');
  if (text === '') return null;
  if (group.trim() !== '') text = text.split(group).join('');
  if (decimal !== '.') text = text.replace(decimal, '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

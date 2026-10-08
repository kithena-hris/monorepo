/* Money as strings of minor units: formatting and parsing, never a float. */

import { numberParts } from '../../lib/intl-parts.ts';

export function decimalsFor(currency: string, locale: string | undefined): number {
  return (
    new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function symbolFor(currency: string, locale: string | undefined): string {
  const parts = numberParts(new Intl.NumberFormat(locale, { style: 'currency', currency }), 0);
  return parts.find((part) => part.type === 'currency')?.value ?? currency;
}

function separators(locale: string | undefined): { group: string; decimal: string } {
  const parts = numberParts(new Intl.NumberFormat(locale), 12_345.6);
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

/** `'124050'`, 2 decimals → `'1,240.50'` in the reader's notation, unsigned. String arithmetic only. */
export function formatMinor(minor: string, decimals: number, locale?: string): string {
  if (minor === '' || minor === '-') return '';
  const { group, decimal } = separators(locale);
  const digits = minor.replace('-', '').padStart(decimals + 1, '0');
  const whole = (digits.slice(0, digits.length - decimals) || '0').replace(
    /\B(?=(\d{3})+(?!\d))/g,
    group,
  );
  return decimals === 0 ? whole : `${whole}${decimal}${digits.slice(digits.length - decimals)}`;
}

/**
 * `'1,240.5'`, 2 decimals → `'124050'`. Never a float: group marks go, the
 * locale's decimal mark becomes the point, extra decimals are cut rather than
 * rounded, so the field never disagrees with what was typed.
 */
export function parseMinor(text: string, decimals: number, locale?: string): string {
  const { group, decimal } = separators(locale);
  const negative = /^\s*[-−]/.test(text);
  const normalised = text.split(group).join('').split(decimal).join('.');
  const cleaned = normalised.replaceAll(/[^\d.]/g, '');
  if (cleaned === '' || cleaned === '.') return negative ? '-' : '';
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const digits = `${whole}${fraction.padEnd(decimals, '0').slice(0, decimals)}`.replace(
    /^0+(?=\d)/,
    '',
  );
  return `${negative ? '-' : ''}${digits}`;
}

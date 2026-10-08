import { describe, expect, it } from 'vitest';

import { dateOrder, numberPartsOf } from './intl-parts.ts';

/**
 * The fallback against the real thing: Node has `formatToParts`, so whatever
 * Hermes on iOS would be given by the fallback is checked against what an
 * engine with the method says, across the shapes locales take.
 */
const cases: [string, Intl.NumberFormatOptions, number][] = [
  ['en-GB', { style: 'currency', currency: 'GBP' }, 1234567],
  ['en-GB', { style: 'currency', currency: 'GBP' }, -1234567],
  ['de-DE', { style: 'currency', currency: 'EUR' }, 1234567],
  ['fr-FR', { style: 'currency', currency: 'EUR' }, -1234567],
  ['ja-JP', { style: 'currency', currency: 'JPY' }, 1234567],
  ['en-IN', { style: 'currency', currency: 'INR' }, 1234567],
  ['de-CH', { style: 'currency', currency: 'CHF' }, 1234],
  ['es-ES', { style: 'currency', currency: 'EUR' }, 1234],
  ['en-GB', { style: 'currency', currency: 'GBP', currencySign: 'accounting' }, -1234567],
  ['en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'code' }, 1234567],
  ['en-GB', { style: 'currency', currency: 'EUR' }, 0],
  ['en-GB', {}, 12345.6],
  ['de-DE', {}, 12345.6],
  ['fr-FR', {}, 12345.6],
];

describe('numberPartsOf', () => {
  it.each(cases)('reads %s %j %d as formatToParts does', (locale, options, value) => {
    const format = new Intl.NumberFormat(locale, options);
    expect(numberPartsOf(format.format(value), value, format)).toEqual(
      format.formatToParts(value).map(({ type, value: v }) => ({ type, value: v })),
    );
  });
});

describe('dateOrder', () => {
  it('says how a locale orders a date', () => {
    expect(dateOrder('en-GB')).toEqual(['day', 'month', 'year']);
    expect(dateOrder('en-US')).toEqual(['month', 'day', 'year']);
    expect(dateOrder('ja-JP')).toEqual(['year', 'month', 'day']);
  });
});

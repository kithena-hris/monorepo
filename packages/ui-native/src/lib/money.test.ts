import { describe, expect, it } from 'vitest';

import { formatMoney, minorUnitsToDecimalString } from './money.ts';

describe('formatMoney', () => {
  it('matches Intl for amounts a double holds exactly', () => {
    const cases: [string, string, string][] = [
      ['428000', 'EUR', 'en-GB'],
      ['365000', 'GBP', 'en-GB'],
      ['512000', 'USD', 'en-US'],
      ['612000', 'JPY', 'ja-JP'],
      ['640050', 'CHF', 'de-CH'],
      ['9200050', 'EUR', 'de-DE'],
      ['9200050', 'EUR', 'fr-FR'],
      ['9200050', 'EUR', 'ja-JP'],
      ['12', 'EUR', 'en-GB'],
      ['123456789', 'INR', 'en-IN'],
      ['420050', 'EUR', 'es-ES'],
      ['1234550', 'EUR', 'es-ES'],
      ['100', 'EUR', 'en-GB'],
    ];
    for (const [minor, currency, locale] of cases) {
      const f = new Intl.NumberFormat(locale, { style: 'currency', currency });
      const places = f.resolvedOptions().maximumFractionDigits ?? 2;
      expect(formatMoney(minor, currency, { locale })).toBe(f.format(Number(minor) / 10 ** places));
    }
  });

  it('keeps every digit a double would lose', () => {
    expect(formatMoney('900719925474099', 'EUR', { locale: 'en-GB' })).toBe(
      '€9,007,199,254,740.99',
    );
  });

  it('uses a true minus, and brackets for a ledger', () => {
    expect(formatMoney('-8600', 'EUR', { locale: 'en-GB' })).toBe('−€86.00');
    expect(formatMoney('-124050', 'EUR', { locale: 'en-GB', accounting: true })).toBe(
      '(€1,240.50)',
    );
  });

  it('moves minor units by string arithmetic', () => {
    expect(minorUnitsToDecimalString('5', 2)).toBe('0.05');
    expect(minorUnitsToDecimalString(-123n, 2)).toBe('-1.23');
  });
});

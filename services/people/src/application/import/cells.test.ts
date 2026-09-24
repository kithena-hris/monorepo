import { describe, expect, it } from 'vitest';

import { define } from '../person/in-memory.js';
import { coerceCell, coerceDate, fromMinor, toMinor, type CellContext } from './cells.js';

const ctx: CellContext = { today: '2026-09-22', dateOrder: 'iso' };
const value = (d: Parameters<typeof define>[0], cell: string, c = ctx) => {
  const r = coerceCell(define(d), cell, c);
  return r.ok ? r.value : `invalid: ${r.error.message}`;
};

describe('money moves digits, never multiplies', () => {
  it('reads amounts exactly in each exponent', () => {
    expect(toMinor('55000.50', 'EUR')).toBe(5_500_050);
    expect(toMinor('55,000.5', 'EUR')).toBe(5_500_050);
    expect(toMinor('0.1', 'EUR')).toBe(10);
    expect(toMinor('1234', 'JPY')).toBe(1234);
    expect(toMinor('1.234', 'BHD')).toBe(1234);
    expect(toMinor('-12.34', 'EUR')).toBe(-1234);
  });

  it('refuses what it would have to guess', () => {
    expect(toMinor('55.000,50', 'EUR')).toBeNull();
    expect(toMinor('1.5', 'JPY')).toBeNull();
    expect(toMinor('12.345', 'EUR')).toBeNull();
    expect(toMinor('12', 'XXXX')).toBeNull();
    expect(toMinor('99999999999999999999', 'EUR')).toBeNull();
  });

  it('writes back what it read', () => {
    for (const [minor, currency] of [
      [5_500_050, 'EUR'],
      [5, 'EUR'],
      [-1234, 'EUR'],
      [1234, 'JPY'],
      [1234, 'BHD'],
    ] as const) {
      expect(toMinor(fromMinor(minor, currency), currency)).toBe(minor);
    }
    expect(fromMinor(5, 'EUR')).toBe('0.05');
  });

  it('takes the currency from the cell, or from a fixed-currency field', () => {
    const salary = {
      key: 'salary',
      dataType: 'money' as const,
      typeConfig: { kind: 'money' as const },
    };
    expect(value(salary, '55000.00 EUR')).toEqual({ amountMinor: 5_500_000, currency: 'EUR' });
    expect(value(salary, 'gbp 10')).toEqual({ amountMinor: 1000, currency: 'GBP' });
    expect(value(salary, '55000')).toMatch(/^invalid/u);
    expect(value({ ...salary, typeConfig: { kind: 'money', currency: 'EUR' } }, '55000')).toEqual({
      amountMinor: 5_500_000,
      currency: 'EUR',
    });
  });
});

describe('dates, across locales', () => {
  const born = {
    key: 'born',
    dataType: 'date' as const,
    typeConfig: { kind: 'date' as const, range: 'past' as const },
  };

  it('reads ISO, and a slash date only when told the order', () => {
    expect(value(born, '1990-04-03')).toBe('1990-04-03');
    expect(value(born, '03/04/1990')).toMatch(/^invalid/u);
    expect(value(born, '03/04/1990', { ...ctx, dateOrder: 'dmy' })).toBe('1990-04-03');
    expect(value(born, '03/04/1990', { ...ctx, dateOrder: 'mdy' })).toBe('1990-03-04');
  });

  it('refuses a day that does not exist, and a range it breaks', () => {
    expect(coerceDate('2026-02-30', 'iso')).toBeUndefined();
    expect(coerceDate('2024-02-29', 'iso')).toBe('2024-02-29');
    expect(value(born, '2090-01-01')).toMatch(/^invalid/u);
  });
});

describe('the rest', () => {
  it('checks a national identifier against its country', () => {
    const nif = {
      key: 'nif',
      dataType: 'national_id' as const,
      typeConfig: { kind: 'national_id' as const, country: 'ES', scheme: 'nif' },
    };
    expect(value(nif, '12345678-z')).toBe('12345678Z');
    // A wrong control letter imports, to be reviewed (PEO-125); a value that
    // cannot be a NIF at all does not.
    expect(value(nif, '12345678A')).toBe('12345678A');
    expect(value(nif, '1234567Z')).toMatch(/^invalid/u);
  });

  it('maps a select by value or label, and refuses anything else', () => {
    const level = {
      key: 'level',
      dataType: 'select' as const,
      typeConfig: {
        kind: 'select' as const,
        options: [{ value: 'l1', label: { default: 'Junior' } }],
      },
    };
    expect(value(level, 'Junior')).toBe('l1');
    expect(value(level, 'L1')).toBe('l1');
    expect(value(level, 'Senior')).toMatch(/^invalid/u);
  });

  it('treats an empty cell as absent, never invalid', () => {
    expect(value({ key: 'x' }, '')).toBeNull();
  });
});

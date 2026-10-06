import { describe, expect, it } from 'vitest';

import { formatNumber, parseNumber } from './number-format.ts';

describe('parseNumber', () => {
  it('reads empty as null, never zero', () => {
    expect(parseNumber('', 'en-GB')).toBeNull();
    expect(parseNumber('   ', 'de-DE')).toBeNull();
    expect(parseNumber('0', 'en-GB')).toBe(0);
  });

  it('reads the locale’s decimal mark and drops its grouping', () => {
    expect(parseNumber('0.8', 'en-GB')).toBe(0.8);
    expect(parseNumber('0,8', 'de-DE')).toBe(0.8);
    expect(parseNumber('2,500', 'en-GB')).toBe(2500);
    expect(parseNumber('92 000,00', 'fr-FR')).toBe(92000);
    expect(parseNumber('1.234,5', 'de-DE')).toBe(1234.5);
  });

  it('takes a true minus, and refuses what is not a number', () => {
    expect(parseNumber('−3', 'en-GB')).toBe(-3);
    expect(parseNumber('1e', 'en-GB')).toBeNull();
  });
});

describe('formatNumber', () => {
  it('writes as the locale does, and empty as empty', () => {
    expect(formatNumber(null, 'en-GB')).toBe('');
    expect(formatNumber(0.8, 'de-DE')).toBe('0,8');
    expect(formatNumber(2500, 'en-GB')).toBe('2,500');
    expect(parseNumber(formatNumber(92000, 'fr-FR', 2), 'fr-FR')).toBe(92000);
  });
});

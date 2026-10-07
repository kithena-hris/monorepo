import { describe, expect, it } from 'vitest';

import { formatMinor, parseMinor } from './money.ts';

describe('parseMinor', () => {
  it('reads major units into minor units without a float', () => {
    expect(parseMinor('1,240.50', 2, 'en-GB')).toBe('124050');
    expect(parseMinor('0.1', 2, 'en-GB')).toBe('10');
    expect(parseMinor('1.240,5', 2, 'de-DE')).toBe('124050');
  });

  it('cuts extra decimals rather than rounding them', () => {
    expect(parseMinor('19.999', 2, 'en-GB')).toBe('1999');
  });

  it('keeps blank blank, and a sign typed on its own', () => {
    expect(parseMinor('', 2, 'en-GB')).toBe('');
    expect(parseMinor('−', 2, 'en-GB')).toBe('-');
    expect(parseMinor('−86', 2, 'en-GB')).toBe('-8600');
  });

  it('knows a currency with no minor unit', () => {
    expect(parseMinor('4,200', 0, 'en-GB')).toBe('4200');
  });
});

describe('formatMinor', () => {
  it('writes minor units back in the locale’s notation, unsigned', () => {
    expect(formatMinor('124050', 2, 'en-GB')).toBe('1,240.50');
    expect(formatMinor('-8600', 2, 'en-GB')).toBe('86.00');
    expect(formatMinor('5', 2, 'en-GB')).toBe('0.05');
    expect(formatMinor('', 2, 'en-GB')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import { bandAmount, toMinorDigits } from './minor';

describe('pay band amounts', () => {
  it('moves digits, never through a float', () => {
    expect(toMinorDigits('55,000.5', 'EUR')).toBe('5500050');
    expect(toMinorDigits('1.005', 'EUR')).toBeNull();
    expect(toMinorDigits('500', 'JPY')).toBe('500');
    expect(toMinorDigits('0', 'EUR')).toBeNull();
    expect(bandAmount('5500050', 'EUR')).toBe('55,000.50 EUR');
  });
});

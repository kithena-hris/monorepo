import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money, minorUnitsToDecimalString } from './money';

describe('minorUnitsToDecimalString', () => {
  it('shifts the decimal point without touching a float', () => {
    expect(minorUnitsToDecimalString('420050', 2)).toBe('4200.50');
    expect(minorUnitsToDecimalString('5', 2)).toBe('0.05');
    expect(minorUnitsToDecimalString('0', 2)).toBe('0.00');
  });

  it('keeps precision that a double would lose', () => {
    // 20000000000.15 is not representable as a double. Going through Number()
    // here would silently produce 20000000000.150002.
    expect(minorUnitsToDecimalString('2000000000015', 2)).toBe('20000000000.15');
  });

  it('handles zero-exponent currencies', () => {
    expect(minorUnitsToDecimalString('1250', 0)).toBe('1250');
  });

  it('preserves the sign', () => {
    expect(minorUnitsToDecimalString('-12345', 2)).toBe('-123.45');
  });

  it('accepts bigint', () => {
    expect(minorUnitsToDecimalString(420050n, 2)).toBe('4200.50');
  });

  it('rejects a value that is not an integer in minor units', () => {
    expect(() => minorUnitsToDecimalString('42.00', 2)).toThrow(TypeError);
  });
});

describe('<Money>', () => {
  it('formats using the currency exponent', () => {
    render(<Money minorUnits="420050" currency="EUR" locale="de-DE" />);
    expect(screen.getByText(/4\.200,50/)).toBeInTheDocument();
  });

  it('formats zero-decimal currencies without a fraction', () => {
    render(<Money minorUnits="1250" currency="JPY" locale="en-US" />);
    expect(screen.getByText('¥1,250')).toBeInTheDocument();
  });

  it('marks the value as numeric so tables align it', () => {
    render(<Money minorUnits="100" currency="USD" locale="en-US" />);
    expect(screen.getByText('$1.00')).toHaveAttribute('data-numeric');
  });
});

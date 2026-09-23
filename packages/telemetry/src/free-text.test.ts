import { describe, expect, it } from 'vitest';

import { contains, haystack, needle } from './free-text.js';

const carries = (text: string, value: string): boolean => {
  const n = needle(value);
  return n !== undefined && contains(haystack([text]), n);
};

describe('free text carrying a value', () => {
  it.each([
    ['IBAN', 'DE89370400440532013000', 'Pay DE89 3704 0044 0532 0130 00 on Friday'],
    ['IBAN, stored spaced', 'DE89 3704 0044 0532 0130 00', 'iban=de89370400440532013000'],
    ['NIF', '12345678Z', 'Her NIF is 12345678-Z.'],
    ['NI number', 'AB123456C', 'NI: ab 12 34 56 c'],
    ['PAN', 'ABCDE1234F', 'PAN abcde-1234-f attached'],
    ['SSN', '123-45-6789', 'ssn 123 45 6789'],
    ['SSN glued to its label', '123456789', 'ssn123456789'],
    ['SSN split by dots', '123456789', 'see 123.45.6789'],
  ])('finds a %s however it is separated', (_shape, value, text) => {
    expect(carries(text, value)).toBe(true);
  });

  it('finds a word value across case, accents, width and invisible characters', () => {
    expect(carries('Is she ROMAN-catholic?', 'Roman Catholic')).toBe(true);
    expect(carries('religion: romancatholic', 'Roman Catholic')).toBe(true);
    expect(carries('diagnosed with DIABETES', 'diabètes')).toBe(true);
    expect(carries('code ＡＢ１２３４５６Ｃ', 'AB123456C')).toBe(true);
    expect(carries('dia​betes', 'diabetes')).toBe(true);
  });

  it('does not find a word value inside another word', () => {
    expect(carries('Ask Christiansen about it', 'Christian')).toBe(false);
    expect(carries('nonetheless', 'none')).toBe(false);
  });

  it('ignores a value with nothing to match', () => {
    expect(needle(' -- ')).toBeUndefined();
  });
});

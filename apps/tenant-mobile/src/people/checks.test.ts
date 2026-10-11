import { describe, expect, it } from 'vitest';

import { ibanCheck, nifSuggestion } from './checks';

describe('what the phone works out as a value is typed', () => {
  it('offers the NIF with its right control letter', () => {
    expect(nifSuggestion('12345678A')).toBe('12345678Z');
    expect(nifSuggestion('12345678Z')).toBeNull();
    expect(nifSuggestion('X1234567A')).toBe('X1234567L');
    expect(nifSuggestion('hello')).toBeNull();
  });

  it('checks an IBAN and names a Spanish bank it knows', () => {
    expect(ibanCheck('ES91 2100 0418 4502 0005 1332')).toEqual({ valid: true, bank: 'CaixaBank' });
    expect(ibanCheck('ES91 2100 0418 4502 0005 1333')?.valid).toBe(false);
    expect(ibanCheck('GB82 WEST 1234 5698 7654 32')).toEqual({ valid: true, bank: null });
    expect(ibanCheck('ES9')).toBeNull();
  });
});

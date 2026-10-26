import { describe, expect, it } from 'vitest';

import { capitalisedName } from './person-name.js';

describe('a name typed in lower case', () => {
  it('has each word capitalised', () => {
    expect(capitalisedName('yuki sato')).toBe('Yuki Sato');
    expect(capitalisedName('anne-marie o’brien')).toBe('Anne-Marie O’Brien');
    expect(capitalisedName('élodie')).toBe('Élodie');
  });

  it('is left alone once it has a capital', () => {
    expect(capitalisedName('van der Berg')).toBe('van der Berg');
    expect(capitalisedName('McKay')).toBe('McKay');
  });
});

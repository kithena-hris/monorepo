import { describe, expect, it } from 'vitest';

import { checkName, displayName } from './person-name.js';

/**
 * A name is typed by the person it belongs to, once, on their first day, and is
 * then rendered in a passkey prompt, an email, a CSV payroll opens and a PDF an
 * inspector reads. Every case here is one of those renderings going wrong.
 */
describe('checkName', () => {
  it('keeps the parts rather than a formatted string', () => {
    const result = checkName({ given: 'Ada', family: 'Lovelace', preferred: null });
    expect(result.ok && result.value).toEqual({
      given: 'Ada',
      family: 'Lovelace',
      preferred: null,
    });
  });

  it('refuses a missing legal name, whatever shape the absence takes', () => {
    for (const input of [{}, { given: '' }, { given: '   ' }, { given: 42 }]) {
      const result = checkName({ family: 'Lovelace', ...input });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.path).toEqual(['given']);
    }
  });

  it('names the field that was wrong, so the form can point at it', () => {
    const result = checkName({ given: 'Ada', family: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toEqual(['family']);
  });

  it('collapses the whitespace a form produces', () => {
    // Otherwise `Ada  Lovelace` and `Ada Lovelace` are two people who never
    // match each other in a search.
    const result = checkName({ given: '  Ada   Mary ', family: ' Lovelace ' });
    expect(result.ok && result.value.given).toBe('Ada Mary');
    expect(result.ok && result.value.family).toBe('Lovelace');
  });

  it('refuses a newline, which would break every CSV this ends up in', () => {
    const result = checkName({ given: 'Ada\nLovelace', family: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NAME_MALFORMED');
  });

  it('refuses a bidirectional override, which reverses whatever follows it', () => {
    // The trick that makes one string display as another. A person's row in a
    // list is as good a place to use it as a filename.
    const result = checkName({ given: 'Ada‮ecalevol', family: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NAME_MALFORMED');
  });

  it('treats a preferred name that repeats the given name as no preferred name', () => {
    // Most people are called their given name, and a form that pre-fills this
    // gets it back unchanged. Storing it would print the same word twice.
    const result = checkName({ given: 'Ada', family: 'Lovelace', preferred: 'Ada' });
    expect(result.ok && result.value.preferred).toBeNull();
  });

  it('accepts a preferred name that is a different name', () => {
    const result = checkName({ given: 'Augusta', family: 'Lovelace', preferred: 'Ada' });
    expect(result.ok && result.value.preferred).toBe('Ada');
  });

  it('refuses a name longer than the column can hold', () => {
    const result = checkName({ given: 'a'.repeat(101), family: 'Lovelace' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NAME_TOO_LONG');
  });
});

describe('displayName', () => {
  it('uses the preferred name, because the prompt is where somebody decides the account is theirs', () => {
    expect(displayName({ given: 'Augusta', family: 'Lovelace', preferred: 'Ada' })).toBe(
      'Ada Lovelace',
    );
  });

  it('falls back to the given name', () => {
    expect(displayName({ given: 'Ada', family: 'Lovelace', preferred: null })).toBe('Ada Lovelace');
  });
});

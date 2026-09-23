import { describe, expect, it } from 'vitest';

import { checkScheme, formatNumber, sequenceOf, type NumberingScheme } from './numbering.js';

/**
 * Employee numbering per legal entity (§7, §9.4, PEO-101): a prefix, a
 * minimum number of digits, and where the sequence starts. The format is what
 * a generated number looks like and what an imported one is held to.
 */

const scheme: NumberingScheme = { prefix: 'ES-', digits: 5 };

describe('a scheme', () => {
  it('takes a prefix, a width and a start', () => {
    expect(checkScheme({ prefix: 'ES-', digits: 5, start: 1000 })).toEqual({
      ok: true,
      value: { prefix: 'ES-', digits: 5, start: 1000 },
    });
    expect(checkScheme({ prefix: '', digits: 1, start: 1 }).ok).toBe(true);
  });

  it('refuses a prefix a spreadsheet would mangle, a silly width, or a start below one', () => {
    for (const bad of [
      { prefix: 'E S', digits: 5, start: 1 },
      { prefix: 'ABCDEFGHIJK', digits: 5, start: 1 },
      { prefix: 'E', digits: 0, start: 1 },
      { prefix: 'E', digits: 13, start: 1 },
      { prefix: 'E', digits: 5, start: 0 },
      { prefix: 'E', digits: 5, start: 1.5 },
    ]) {
      expect(checkScheme(bad).ok).toBe(false);
    }
  });

  it('refuses a start that does not fit the width', () => {
    const refused = checkScheme({ prefix: 'E', digits: 3, start: 1000 });
    expect(!refused.ok && refused.error.code).toBe('NUMBERING_INVALID');
  });
});

describe('a number', () => {
  it('is the prefix and the sequence, zero-padded to the width', () => {
    expect(formatNumber(scheme, 42)).toBe('ES-00042');
    // Past the width it grows rather than wrapping.
    expect(formatNumber(scheme, 123456)).toBe('ES-123456');
  });

  it('reads back to its sequence only when it is exactly what the scheme would write', () => {
    expect(sequenceOf(scheme, 'ES-00042')).toBe(42);
    expect(sequenceOf(scheme, 'ES-123456')).toBe(123456);
    expect(sequenceOf(scheme, 'ES-42')).toBeNull();
    expect(sequenceOf(scheme, 'ES-000042')).toBeNull();
    expect(sequenceOf(scheme, 'FR-00042')).toBeNull();
    expect(sequenceOf(scheme, 'ES-0004a')).toBeNull();
    expect(sequenceOf(scheme, 'ES-00000')).toBeNull();
  });
});

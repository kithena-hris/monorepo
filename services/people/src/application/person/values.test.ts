import { describe, expect, it } from 'vitest';

import { define } from './in-memory.js';
import { valueSchemaFor } from './values.js';

describe('a signature field', () => {
  const signature = valueSchemaFor(
    define({ key: 'signature', dataType: 'signature', typeConfig: { kind: 'signature' } }),
    '2026-10-13',
  );

  it('keeps a signature as its JSON text, typed in a face or drawn', () => {
    const typed = JSON.stringify({ kind: 'typed', text: 'Ada Lovelace', style: 'light' });
    expect(signature.safeParse(typed).success).toBe(true);
    const drawn = JSON.stringify({ kind: 'drawn', path: 'M 1 2 L 3 4' });
    expect(signature.safeParse(drawn).success).toBe(true);
  });

  it('refuses a name, a broken one, or anything that is not text', () => {
    expect(signature.safeParse('Ada Lovelace').success).toBe(false);
    expect(signature.safeParse(JSON.stringify({ kind: 'drawn', path: '<svg/>' })).success).toBe(
      false,
    );
    expect(signature.safeParse({ kind: 'typed', text: 'Ada' }).success).toBe(false);
  });
});

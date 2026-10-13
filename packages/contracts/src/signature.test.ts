import { describe, expect, it } from 'vitest';

import { inkBounds, SignatureMark } from './signature.js';

describe('a signature', () => {
  it('is typed in a face, flowing unless said, or drawn as straight strokes', () => {
    expect(SignatureMark.parse({ kind: 'typed', text: ' Ada Lovelace ' })).toEqual({
      kind: 'typed',
      text: 'Ada Lovelace',
      style: 'flowing',
    });
    expect(SignatureMark.safeParse({ kind: 'typed', text: '  ' }).success).toBe(false);
    expect(SignatureMark.safeParse({ kind: 'drawn', path: 'M 1 2 L 3 4' }).success).toBe(true);
    expect(SignatureMark.safeParse({ kind: 'drawn', path: '<script>' }).success).toBe(false);
  });

  it('knows where a drawing’s ink is, to centre it', () => {
    expect(inkBounds('M 10 20 L 110 60 M 50 30 L 60 100')).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
    });
    expect(inkBounds('')).toBeNull();
  });
});

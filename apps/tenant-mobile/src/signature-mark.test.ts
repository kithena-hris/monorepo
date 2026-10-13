import { describe, expect, it } from 'vitest';

import { markOf } from './signature-mark';

describe('markOf', () => {
  it('reads a typed signature, flowing when no style was kept', () => {
    expect(markOf('{"kind":"typed","text":"Ada Lovelace","style":"bold"}')).toEqual({
      kind: 'typed',
      text: 'Ada Lovelace',
      style: 'bold',
    });
    expect(markOf('{"kind":"typed","text":"Ada"}')).toEqual({
      kind: 'typed',
      text: 'Ada',
      style: 'flowing',
    });
  });

  it('reads a drawn one', () => {
    expect(markOf('{"kind":"drawn","path":"M 1 2 L 3 4"}')).toEqual({
      kind: 'drawn',
      path: 'M 1 2 L 3 4',
    });
  });

  it('has none for nothing, or for text that is not a signature', () => {
    expect(markOf(undefined)).toBeNull();
    expect(markOf('')).toBeNull();
    expect(markOf('Ada')).toBeNull();
    expect(markOf('{"kind":"typed"}')).toBeNull();
  });

  it('refuses what the server would: a path that is not strokes, or a blank name', () => {
    expect(markOf('{"kind":"drawn","path":"<script>"}')).toBeNull();
    expect(markOf('{"kind":"typed","text":"   "}')).toBeNull();
    expect(markOf('{"kind":"typed","text":"Ada","style":"cursive"}')).toBeNull();
  });
});

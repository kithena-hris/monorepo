import { describe, expect, it } from 'vitest';

import { CENSOR, redactKeys } from './redact-keys.js';

const keys = new Set(['religion']);

describe('redactKeys', () => {
  it('returns the very same object when nothing matches', () => {
    const line = { a: { b: [1, { c: 'x' }] } };
    expect(redactKeys(line, keys)).toBe(line);
  });

  it('copies only the path to a match, and leaves the caller’s object alone', () => {
    const untouched = { c: 'x' };
    const line = { a: { religion: 'y' }, b: untouched };
    const out = redactKeys(line, keys);
    expect(out).toEqual({ a: { religion: CENSOR }, b: untouched });
    expect(out.b).toBe(untouched);
    expect(line.a.religion).toBe('y');
  });

  it('keeps an Error an Error', () => {
    const error = Object.assign(new Error('boom'), { religion: 'y' });
    const out = redactKeys({ err: error }, keys).err;
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe('boom');
    expect(out.religion).toBe(CENSOR);
  });

  it('censors a cycle rather than walk it forever', () => {
    const line: Record<string, unknown> = { religion: 'y' };
    line['self'] = line;
    expect(redactKeys(line, keys)).toEqual({ religion: CENSOR, self: CENSOR });
  });

  it('censors past its depth bound rather than pass unseen data', () => {
    let line: unknown = { ok: 1 };
    for (let i = 0; i < 40; i += 1) line = { a: line };
    expect(JSON.stringify(redactKeys(line, keys))).toContain(CENSOR);
  });
});

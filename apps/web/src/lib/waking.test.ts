import { describe, expect, it } from 'vitest';

import { isWaking, retryDelay, wakingCause, wakingErrors, wakingStatus } from './waking';

const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
  name: 'TimeoutError',
});

describe('waking or broken', () => {
  it('is waking when only the gateway in front of the router answers', () => {
    for (const status of [502, 503, 504, 521, 522, 523, 530])
      expect(wakingStatus(status)).toBe(true);
  });

  it('is an error when the router itself answers', () => {
    for (const status of [200, 400, 401, 403, 404, 413, 429, 500]) {
      expect(wakingStatus(status)).toBe(false);
    }
  });

  it('is waking when nobody answers, and when a read times out', () => {
    expect(wakingCause(new TypeError('fetch failed'), false)).toBe(true);
    expect(wakingCause(new TypeError('fetch failed'), true)).toBe(true);
    expect(wakingCause(timeout, false)).toBe(true);
  });

  it('is not waking when a write times out: it may have been applied', () => {
    expect(wakingCause(timeout, true)).toBe(false);
  });

  it('is waking when the router could not reach People, and not for People’s own error', () => {
    expect(wakingErrors([{ message: "Failed to fetch from Subgraph 'people'." }])).toBe(true);
    expect(wakingErrors([{ message: 'You may not see this record' }])).toBe(false);
    expect(wakingErrors([{}])).toBe(false);
    expect(wakingErrors(undefined)).toBe(false);
  });

  it('reads an answer the shell got back', () => {
    expect(isWaking({ ok: false, code: 'UNREACHABLE' })).toBe(true);
    expect(isWaking({ ok: false, code: 'FORBIDDEN' })).toBe(false);
    expect(isWaking({ ok: false, code: 'UNAVAILABLE' })).toBe(false);
    expect(isWaking({ ok: true })).toBe(false);
  });
});

describe('retryDelay', () => {
  it('backs off 2 s, 3 s, 5 s, then every 5 s', () => {
    expect([0, 1, 2, 3, 4, 20].map(retryDelay)).toEqual([2_000, 3_000, 5_000, 5_000, 5_000, 5_000]);
  });
});

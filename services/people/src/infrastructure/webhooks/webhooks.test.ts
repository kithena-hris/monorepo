import { describe, expect, it } from 'vitest';

import { nextAttempt } from './webhooks.js';

const at = (iso: string) => new Date(iso);
const first = at('2030-01-01T00:00:00.000Z');

describe('backoff', () => {
  it('starts at 30 seconds and doubles', () => {
    expect(nextAttempt(first, 1, first)?.toISOString()).toBe('2030-01-01T00:00:30.000Z');
    expect(nextAttempt(first, 3, first)?.toISOString()).toBe('2030-01-01T00:02:00.000Z');
  });

  it('lands the last retry on the 24-hour mark, then gives up', () => {
    const late = at('2030-01-01T22:00:00.000Z');
    expect(nextAttempt(first, 20, late)?.toISOString()).toBe('2030-01-02T00:00:00.000Z');
    expect(nextAttempt(first, 21, at('2030-01-02T00:00:00.000Z'))).toBeNull();
  });
});

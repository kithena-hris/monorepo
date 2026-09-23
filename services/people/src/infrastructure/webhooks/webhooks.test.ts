import { describe, expect, it } from 'vitest';

import { nextAttempt, publicHttpsUrl } from './webhooks.js';

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

describe('where a webhook may point', () => {
  it('accepts a public https address', () => {
    expect(publicHttpsUrl('https://hooks.example.com/people')).toBe(true);
  });

  it.each([
    'http://hooks.example.com/',
    'https://localhost/x',
    'https://10.0.0.5/x',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x',
    'https://user:pass@hooks.example.com/',
    'not a url',
  ])('refuses %s', (url) => {
    expect(publicHttpsUrl(url)).toBe(false);
  });
});

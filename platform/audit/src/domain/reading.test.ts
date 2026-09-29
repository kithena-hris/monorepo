import { describe, expect, it } from 'vitest';

import { dayBounds, mayRead, retentionCutoff } from './reading.js';

describe('who reads the log', () => {
  it('is People administrators and HR, and Kithena support at the company', () => {
    expect(mayRead({ roles: new Set(['people_admin']), support: false })).toBe(true);
    expect(mayRead({ roles: new Set(['hr']), support: false })).toBe(true);
    expect(mayRead({ roles: new Set(), support: true })).toBe(true);
  });

  it('is nobody else, finance included', () => {
    expect(mayRead({ roles: new Set(['finance']), support: false })).toBe(false);
    expect(mayRead({ roles: new Set(), support: false })).toBe(false);
  });
});

describe('a date range', () => {
  it('is whole days on the reader’s clock', () => {
    // Madrid is two hours ahead in September: its 1st starts on the 31st in UTC.
    expect(dayBounds('2026-09-01', '2026-09-29', 'Europe/Madrid')).toEqual({
      from: '2026-08-31T22:00:00.000Z',
      until: '2026-09-29T22:00:00.000Z',
    });
  });

  it('leaves an open end open, and reads a missing zone as UTC', () => {
    expect(dayBounds(null, '2026-09-29', null)).toEqual({
      from: null,
      until: '2026-09-30T00:00:00.000Z',
    });
  });
});

describe('retention', () => {
  it('keeps everything until a period is set (PEO-129)', () => {
    expect(retentionCutoff(null, new Date('2026-09-29T00:00:00Z'))).toBeNull();
  });

  it('removes what is older than the period, once one is', () => {
    expect(retentionCutoff(30, new Date('2026-09-29T00:00:00Z'))).toBe('2026-08-30T00:00:00.000Z');
  });
});

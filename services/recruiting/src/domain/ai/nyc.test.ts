import { describe, expect, it } from 'vitest';

import { inNewYorkCity, nycGate } from './nyc.js';

const nyc = { country: 'US', region: 'NY', city: 'Brooklyn' };
const sf = { country: 'US', region: 'CA', city: 'San Francisco' };

describe('NYC Local Law 144 (PRD §22.8)', () => {
  it('knows a New York City location', () => {
    expect(inNewYorkCity([sf])).toBe(false);
    expect(inNewYorkCity([sf, nyc])).toBe(true);
    expect(inNewYorkCity([{ country: 'US', region: 'NY', city: 'Albany' }])).toBe(false);
  });

  it('keeps the matrix off without an audit in the last year', () => {
    expect(nycGate([nyc], null, '2026-10-01', '2026-10-30')).toEqual({
      ok: false,
      reason: 'audit',
    });
    expect(nycGate([nyc], '2025-10-01', '2026-10-01', '2026-10-30')).toEqual({
      ok: false,
      reason: 'audit',
    });
  });

  it('waits ten business days after the candidate saw the notice', () => {
    // Applied on Thursday 1 October; ten business days later is Thursday 15 October.
    expect(nycGate([nyc], '2026-06-01', '2026-10-01', '2026-10-14')).toEqual({
      ok: false,
      reason: 'notice',
    });
    expect(nycGate([nyc], '2026-06-01', '2026-10-01', '2026-10-15')).toEqual({ ok: true });
  });

  it('does not apply outside New York City', () => {
    expect(nycGate([sf], null, '2026-10-14', '2026-10-14')).toEqual({ ok: true });
  });
});

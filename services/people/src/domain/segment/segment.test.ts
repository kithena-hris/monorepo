import { describe, expect, it } from 'vitest';

import { checkSegment, mayDelete, seenBy, type Segment } from './segment.js';

/**
 * A saved segment is a named filter and nothing else (PRD §16.3, PEO-068).
 * It never holds a list of people, so whoever uses it gets the people *they*
 * may see matching it, decided when they use it.
 */

const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000b2';

const saved = (over: Partial<Segment> = {}): Segment => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Madrid engineering',
  filter: { org_unit: 'eng', work_location: 'mad' },
  ownerAccountId: PRIYA,
  shared: false,
  ...over,
});

describe('checkSegment', () => {
  it('keeps a name and a filter, trimmed', () => {
    expect(
      checkSegment({ name: '  Madrid  ', filter: { org_unit: ' eng ' }, shared: true }),
    ).toEqual({ ok: true, value: { name: 'Madrid', filter: { org_unit: 'eng' }, shared: true } });
  });

  it('refuses a blank or overlong name', () => {
    expect(checkSegment({ name: '  ', filter: { a: 'b' }, shared: false })).toMatchObject({
      ok: false,
      error: { code: 'SEGMENT_NAME' },
    });
    expect(checkSegment({ name: 'x'.repeat(81), filter: { a: 'b' }, shared: false })).toMatchObject(
      { ok: false, error: { code: 'SEGMENT_NAME' } },
    );
  });

  it('refuses a filter that matches everybody: that is not a segment', () => {
    expect(checkSegment({ name: 'All', filter: {}, shared: false })).toMatchObject({
      ok: false,
      error: { code: 'SEGMENT_FILTER' },
    });
  });

  it('refuses a key that is not an attribute key, and more than ten conditions', () => {
    expect(checkSegment({ name: 'n', filter: { 'Org Unit': 'x' }, shared: false })).toMatchObject({
      ok: false,
      error: { code: 'SEGMENT_FILTER' },
    });
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${String(i)}`, 'v']));
    expect(checkSegment({ name: 'n', filter: eleven, shared: false })).toMatchObject({
      ok: false,
      error: { code: 'SEGMENT_FILTER' },
    });
  });

  it("refuses an empty value, and a comma, which the directory's key:value,… form cannot carry", () => {
    expect(checkSegment({ name: 'n', filter: { a: ' ' }, shared: false })).toMatchObject({
      ok: false,
      error: { code: 'SEGMENT_FILTER' },
    });
    expect(checkSegment({ name: 'n', filter: { a: 'x,y' }, shared: false })).toMatchObject({
      ok: false,
      error: { code: 'SEGMENT_FILTER' },
    });
  });
});

describe('who sees a segment', () => {
  it('is its owner, and everybody in the tenant once it is shared', () => {
    expect(seenBy(saved(), PRIYA)).toBe(true);
    expect(seenBy(saved(), MARCO)).toBe(false);
    expect(seenBy(saved({ shared: true }), MARCO)).toBe(true);
  });

  it('is deleted by its owner only, shared or not', () => {
    expect(mayDelete(saved({ shared: true }), PRIYA).ok).toBe(true);
    expect(mayDelete(saved({ shared: true }), MARCO)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});

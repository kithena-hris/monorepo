import { describe, expect, it } from 'vitest';

import { adverseImpact, type Person } from './impact.js';

const people = (group: string, n: number, reached: number, ai = false): Person[] =>
  Array.from({ length: n }, (_, i) => ({ group, reachedRank: i < reached ? 2 : 0, ai }));

describe('stage pass rates by self-ID group, four-fifths rule (PRD §22.6)', () => {
  it('compares each group with the highest rate', () => {
    const rows = adverseImpact(
      [...people('a', 10, 6), ...people('b', 10, 3)],
      [{ rank: 2, name: 'Interview' }],
    );
    expect(rows).toEqual([
      { stage: 'Interview', group: 'a', n: 10, rateBp: 6_000, ratioBp: 10_000, flagged: false },
      { stage: 'Interview', group: 'b', n: 10, rateBp: 3_000, ratioBp: 5_000, flagged: true },
    ]);
  });

  it('withholds a group under five people', () => {
    const rows = adverseImpact(
      [...people('a', 10, 6), ...people('c', 4, 1)],
      [{ rank: 2, name: 'Interview' }],
    );
    expect(rows.map((r) => r.group)).toEqual(['a']);
  });

  it('splits AI-assisted from not, when asked', () => {
    const rows = adverseImpact(
      [...people('a', 5, 5, true), ...people('a', 5, 0, false)],
      [{ rank: 2, name: 'Interview' }],
      (p) => p.ai,
    );
    expect(rows.map((r) => r.rateBp)).toEqual([10_000]);
  });
});

import { describe, expect, it } from 'vitest';
import { DateSpan } from '@kithena/contracts';

import { d, members, october, platform } from '../coverage/october-2026.fixture.js';
import { alternatives } from './alternatives.js';

const minimum = { atLeast: 5, unit: 'people' } as const;
const adamsRequest = {
  personId: platform.adam,
  span: DateSpan.parse({ from: '2026-10-19', to: '2026-10-23' }),
};
const others = october.filter((a) => a.personId !== platform.adam);
const span = (from: string, to: string) => DateSpan.parse({ from, to });

describe('clash fixes and counter-proposals (PRD §9.5, §9.6, T15, T18)', () => {
  const options = alternatives({ request: adamsRequest, members, absences: others, minimum });

  it('first asks Adam to swap Wed 21 for the next working day that keeps 5 in: 19, 20, 22, 23 and 26 Oct', () => {
    expect(options[0]).toMatchObject({
      kind: 'swap_days',
      affects: 'requester',
      dates: ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23', '2026-10-26'].map(d),
      spans: [span('2026-10-19', '2026-10-20'), span('2026-10-22', '2026-10-26')],
      swapped: { out: [d('2026-10-21')], in: [d('2026-10-26')] },
    });
    // "Leo is off the 26th too, but that still leaves 5 in."
    expect(options[0]?.coverage.map((c) => c.in)).toEqual([5, 5, 6, 6, 5]);
  });

  it('then the next clean week, 26–30 Oct, with Leo off too and 5 of 7 in every day', () => {
    expect(options[1]).toMatchObject({
      kind: 'next_clean_week',
      affects: 'requester',
      spans: [span('2026-10-26', '2026-10-30')],
    });
    expect(options[1]?.coverage.every((c) => c.in === 5 && !c.below)).toBe(true);
  });

  it('then approve as asked, which stays at 4 of 7 for one day', () => {
    expect(options[2]).toMatchObject({
      kind: 'approve_as_asked',
      affects: 'nobody',
      spans: [adamsRequest.span],
    });
    expect(options[2]?.coverage.filter((c) => c.below).map((c) => [c.date, c.in])).toEqual([
      [d('2026-10-21'), 4],
    ]);
  });

  it('last, ask a teammate whose approved time covers the clash, the smallest ask first', () => {
    expect(options.slice(3)).toMatchObject([
      {
        kind: 'ask_teammate',
        affects: 'teammate',
        teammate: platform.yuki,
        absence: span('2026-10-21', '2026-10-21'),
      },
      {
        kind: 'ask_teammate',
        affects: 'teammate',
        teammate: platform.omar,
        absence: span('2026-10-19', '2026-10-21'),
      },
    ]);
    expect(options[3]?.coverage.some((c) => c.below)).toBe(false);
  });

  it('a request that breaks no minimum has one option, approve as asked', () => {
    const clean = { personId: platform.adam, span: span('2026-10-26', '2026-10-30') };
    const result = alternatives({ request: clean, members, absences: others, minimum });
    expect(result.map((o) => o.kind)).toEqual(['approve_as_asked']);
  });

  it('is deterministic: the same inputs rank the same way', () => {
    expect(
      alternatives({ request: adamsRequest, members, absences: others.toReversed(), minimum }),
    ).toEqual(options);
  });
});

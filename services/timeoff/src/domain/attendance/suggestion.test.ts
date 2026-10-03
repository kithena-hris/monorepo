import { describe, expect, it } from 'vitest';
import { Instant } from '@kithena/contracts';

import { finishCandidates } from './suggestion.js';

const at = (s: string): Instant => Instant.parse(s);

/** Wednesday 30 September 2026 in Madrid (UTC+2): last punch 14:03, back from lunch. */
const day = {
  lastPunchAt: at('2026-09-30T12:03:00.000Z'),
  dayEnds: at('2026-09-30T22:00:00.000Z'),
};

describe('finishCandidates', () => {
  it('offers each sighting after the last punch, rounded up to five minutes, latest first', () => {
    expect(
      finishCandidates({
        ...day,
        seen: [
          { source: 'calendar', at: at('2026-09-30T15:30:00.000Z') },
          { source: 'kithena', at: at('2026-09-30T16:04:00.000Z') },
        ],
      }),
    ).toEqual([
      { at: '2026-09-30T16:05:00.000Z', source: 'kithena' },
      { at: '2026-09-30T15:30:00.000Z', source: 'calendar' },
    ]);
  });

  it('leaves out what came before the last punch or after the day, and joins two in one slot', () => {
    expect(
      finishCandidates({
        ...day,
        seen: [
          { source: 'kithena', at: at('2026-09-30T11:00:00.000Z') },
          { source: 'kithena', at: at('2026-09-30T23:10:00.000Z') },
          { source: 'calendar', at: at('2026-09-30T16:01:00.000Z') },
          { source: 'kithena', at: at('2026-09-30T16:04:00.000Z') },
        ],
      }),
    ).toEqual([{ at: '2026-09-30T16:05:00.000Z', source: 'calendar' }]);
  });

  it('offers nothing with nothing seen', () => {
    expect(finishCandidates({ ...day, seen: [] })).toEqual([]);
  });
});

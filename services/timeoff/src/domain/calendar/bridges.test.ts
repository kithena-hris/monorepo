import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@kithena/contracts';

import { findBridges } from './bridges.js';
import { MONDAY_TO_FRIDAY, type WorkCalendar } from './working-days.js';

const d = (s: string): CalendarDate => CalendarDate.parse(s);
const calendar = (holidays: string[], pattern = MONDAY_TO_FRIDAY): WorkCalendar => ({
  pattern,
  holidays: new Set(holidays.map(d)),
});
const window = { from: d('2026-10-02'), to: d('2027-01-31') };

describe('findBridges', () => {
  it('takes the Monday before a Tuesday holiday: 1 day for 4', () => {
    expect(findBridges(calendar(['2026-12-08']), window, [])).toEqual([
      {
        from: '2026-12-07',
        to: '2026-12-07',
        used: 1,
        away: { from: '2026-12-05', to: '2026-12-08', days: 4 },
        holidays: ['2026-12-08'],
      },
    ]);
  });

  it('takes the Friday after a Thursday holiday', () => {
    expect(findBridges(calendar(['2026-10-15']), window, [])[0]).toMatchObject({
      from: '2026-10-16',
      away: { from: '2026-10-15', to: '2026-10-18', days: 4 },
    });
  });

  it('fills the days between two holidays, best value first', () => {
    const found = findBridges(calendar(['2026-12-08', '2026-12-25', '2027-01-01']), window, []);
    expect(found.map((b) => [b.from, b.to, b.used, b.away.days])).toEqual([
      ['2026-12-07', '2026-12-07', 1, 4],
      ['2026-12-28', '2026-12-31', 4, 10],
    ]);
  });

  it('reads the member’s own week, not Monday to Friday', () => {
    // Tuesday to Saturday: a Wednesday holiday makes Tuesday the bridge, Sunday to Wednesday.
    const tueToSat = new Set([2, 3, 4, 5, 6]);
    expect(findBridges(calendar(['2026-10-21'], tueToSat), window, [])).toEqual([
      {
        from: '2026-10-20',
        to: '2026-10-20',
        used: 1,
        away: { from: '2026-10-18', to: '2026-10-21', days: 4 },
        holidays: ['2026-10-21'],
      },
    ]);
  });

  it('leaves out an ordinary short week, a day already booked and a day already past', () => {
    expect(findBridges(calendar([], new Set([1, 2, 3, 4])), window, [])).toEqual([]);
    expect(
      findBridges(calendar(['2026-12-08']), window, [
        { from: d('2026-12-07'), to: d('2026-12-11') },
      ]),
    ).toEqual([]);
    expect(findBridges(calendar(['2026-12-08']), { ...window, from: d('2026-12-08') }, [])).toEqual(
      [],
    );
  });
});

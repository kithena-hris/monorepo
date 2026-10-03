import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@kithena/contracts';

import { nextBridge } from './nudge.js';

const d = (s: string) => CalendarDate.parse(s);
// Madrid's late 2026: Tuesday 8 December, and Monday 7 December between it and the weekend.
const holidays = [
  { date: d('2026-10-12'), name: 'Fiesta Nacional de España' },
  { date: d('2026-12-08'), name: 'Inmaculada Concepción' },
  { date: d('2026-12-25'), name: 'Navidad' },
];

describe('nextBridge (T28)', () => {
  it('finds the working day that joins the next Tuesday or Thursday holiday to a weekend', () => {
    expect(nextBridge(holidays, d('2026-10-15'), [], d('2026-12-31'))).toEqual({
      take: '2026-12-07',
      from: '2026-12-05',
      to: '2026-12-08',
      holiday: 'Inmaculada Concepción',
    });
  });

  it('skips a day already booked or itself a holiday, and looks no further than the year', () => {
    const end = d('2026-12-31');
    expect(
      nextBridge(holidays, d('2026-10-15'), [{ from: d('2026-12-07'), to: d('2026-12-07') }], end),
    ).toBeNull();
    expect(
      nextBridge(
        [...holidays, { date: d('2026-12-07'), name: 'Constitución' }],
        d('2026-10-15'),
        [],
        end,
      ),
    ).toBeNull();
    expect(nextBridge(holidays, d('2026-10-15'), [], d('2026-11-30'))).toBeNull();
  });
});

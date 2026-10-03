import { describe, expect, it } from 'vitest';

import { bridgeDays, upcomingHolidays } from './timeoff-views';

// Madrid's late 2026, as the demo company has it.
const madrid = [
  { date: '2026-08-15', name: 'Asunción', layer: 'national' },
  { date: '2026-10-12', name: 'Fiesta Nacional', layer: 'national' },
  { date: '2026-11-09', name: 'La Almudena', layer: 'city' },
  { date: '2026-12-08', name: 'Inmaculada Concepción', layer: 'national' },
  { date: '2026-12-25', name: 'Navidad', layer: 'national' },
];

describe('bridgeDays', () => {
  it('finds the Monday before a Tuesday holiday: 1 day for 4, Saturday to Tuesday', () => {
    expect(bridgeDays(madrid, '2026-10-01', [])).toEqual([
      {
        take: '2026-12-07',
        from: '2026-12-05',
        to: '2026-12-08',
        holiday: 'Inmaculada Concepción',
        days: 4,
      },
    ]);
  });

  it('finds the Friday after a Thursday, and skips a day already booked or a holiday', () => {
    const thursday = [{ date: '2026-12-31', name: 'Nochevieja', layer: 'company' }];
    expect(bridgeDays(thursday, '2026-10-01', [])[0]).toMatchObject({
      take: '2027-01-01',
      from: '2026-12-31',
      to: '2027-01-03',
    });
    expect(bridgeDays(thursday, '2026-10-01', [{ from: '2026-12-28', to: '2027-01-01' }])).toEqual(
      [],
    );
    const both = [...thursday, { date: '2027-01-01', name: 'Año Nuevo', layer: 'national' }];
    expect(bridgeDays(both, '2026-10-01', [])).toEqual([]);
  });

  it('never suggests a day that has passed', () => {
    expect(bridgeDays(madrid, '2026-12-07', [])).toEqual([]);
  });
});

describe('upcomingHolidays', () => {
  it('keeps today and later, soonest first', () => {
    expect(upcomingHolidays(madrid.toReversed(), '2026-10-12', 2).map((h) => h.date)).toEqual([
      '2026-10-12',
      '2026-11-09',
    ]);
  });
});

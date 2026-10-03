import { describe, expect, it } from 'vitest';

import { upcomingHolidays } from './timeoff-views';

// Madrid's late 2026, as the demo company has it.
const madrid = [
  { date: '2026-08-15', name: 'Asunción', layer: 'national' },
  { date: '2026-10-12', name: 'Fiesta Nacional', layer: 'national' },
  { date: '2026-11-09', name: 'La Almudena', layer: 'city' },
  { date: '2026-12-08', name: 'Inmaculada Concepción', layer: 'national' },
  { date: '2026-12-25', name: 'Navidad', layer: 'national' },
];

describe('upcomingHolidays', () => {
  it('keeps today and later, soonest first', () => {
    expect(upcomingHolidays(madrid.toReversed(), '2026-10-12', 2).map((h) => h.date)).toEqual([
      '2026-10-12',
      '2026-11-09',
    ]);
  });
});

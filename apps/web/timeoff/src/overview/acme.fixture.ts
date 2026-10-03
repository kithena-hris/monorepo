import type { OverviewData } from './overview';

/**
 * Adam Novak's overview at Acme, as the demo company answers it on Thursday
 * 1 October 2026 at 12:33 in Madrid (`services/timeoff/src/seed/acme.ts`,
 * `docs/demo-company.md`): clocked in since 08:52, 11.5 days of vacation of
 * 25 with 10.5 used and 3 booked, 2 personal days of 3, 6 hours of comp time,
 * Hana off sick, and Madrid's holidays ahead.
 */
export const adam = (): OverviewData => ({
  member: {
    personId: '7ac0e000-0000-7000-8000-000000000002',
    displayName: 'Adam Novak',
    firstName: 'Adam',
    teamName: 'Platform',
    timeZone: 'Europe/Madrid',
  },
  clock: {
    state: 'in',
    workModel: 'office',
    today: {
      date: '2026-10-01',
      workedMinutes: 221,
      breakMinutes: 0,
      plannedMinutes: 480,
      segments: [{ kind: 'live', from: 532, to: 753 }],
    },
  },
  balances: [
    {
      leaveTypeKey: 'vacation',
      name: 'Vacation',
      unit: 'day',
      colorToken: 'chart-1',
      icon: 'sun',
      left: '11.500',
      used: '10.500',
      booked: '3.000',
      allowance: '22.917',
      yearly: '25.000',
    },
    {
      leaveTypeKey: 'personal',
      name: 'Personal day',
      unit: 'day',
      colorToken: 'chart-2',
      icon: 'coffee',
      left: '2.000',
      used: '1.000',
      booked: '0.000',
      allowance: '3.000',
      yearly: '3.000',
    },
    {
      leaveTypeKey: 'comp',
      name: 'Comp time',
      unit: 'hour',
      colorToken: 'chart-4',
      icon: 'timer',
      left: '6.000',
      used: '0.000',
      booked: '0.000',
      allowance: '6.000',
      yearly: null,
    },
  ],
  comingUp: [
    {
      requestId: '0199a000-0000-7000-8000-000000000011',
      leaveTypeKey: 'vacation',
      leaveTypeName: 'Vacation',
      status: 'approved',
      span: { from: '2026-11-10', to: '2026-11-12', startsHalfDay: false, endsHalfDay: false },
      workingDays: '3.000',
      waitingOn: null,
    },
  ],
  teamToday: [
    {
      personId: '7ac0e000-0000-7000-8000-000000000006',
      displayName: 'Hana Kim',
      leaveTypeKey: null,
      span: { from: '2026-10-01', to: '2026-10-02', startsHalfDay: false, endsHalfDay: false },
    },
  ],
  holidays: [
    { date: '2026-10-12', name: 'Fiesta Nacional', layer: 'national' },
    { date: '2026-11-09', name: 'La Almudena', layer: 'city' },
    { date: '2026-12-08', name: 'Inmaculada Concepción', layer: 'national' },
    { date: '2026-12-25', name: 'Navidad', layer: 'national' },
  ],
  bridges: [
    {
      from: '2026-12-07',
      to: '2026-12-07',
      used: 1,
      away: { from: '2026-12-05', to: '2026-12-08', days: 4 },
      holidays: [{ date: '2026-12-08', name: 'Inmaculada Concepción' }],
      text: { text: '4 days off, 5–8 Dec, with Inmaculada Concepción.', ai: false },
    },
  ],
  now: '2026-10-01T10:33:00.000Z',
});

import type { InsightsData } from './insights';

/**
 * Acme's insights for Ada on Thursday 1 October 2026: 412 people, so the
 * company's sick leave is a total it may show; Engineering and Sales are
 * large enough to describe, and the three teams under ten are left out.
 * People are a handful of the 412, enough to draw the lists.
 */

const P = (n: number): string => `7ac0e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const adaInsights = (over: Partial<InsightsData> = {}): InsightsData => ({
  tab: 'what-changed',
  point: null,
  asOf: '2026-10-01',
  scope: 'company',
  cohortMinimum: 10,
  points: [
    {
      kind: 'unbooked',
      figure: '1240',
      text: '1240 days of vacation are still unbooked this year. At this pace 3 people will lose some at the year end.',
      sources: ['Balances', 'Carry-over'],
      personIds: [P(2), P(3), P(4)],
    },
    {
      kind: 'no_break',
      figure: '4',
      text: '4 people haven’t taken a day off since June.',
      sources: ['Time off'],
      personIds: [P(3), P(5), P(6), P(7)],
    },
    {
      kind: 'missed_clock_outs',
      figure: '6',
      text: 'Missed clock-outs went from 19 last month to 6 this month.',
      sources: ['Attendance'],
      personIds: [],
    },
  ],
  months: [
    {
      month: '2026-05',
      vacation: '300.000',
      personal: '40.000',
      sick: '60.000',
      missedClockOuts: 14,
      overtimeMinutes: 1800,
    },
    {
      month: '2026-06',
      vacation: '420.000',
      personal: '50.000',
      sick: '48.000',
      missedClockOuts: 17,
      overtimeMinutes: 2100,
    },
    {
      month: '2026-07',
      vacation: '760.000',
      personal: '40.000',
      sick: '30.000',
      missedClockOuts: 21,
      overtimeMinutes: 1200,
    },
    {
      month: '2026-08',
      vacation: '1110.000',
      personal: '30.000',
      sick: '44.000',
      missedClockOuts: 19,
      overtimeMinutes: 900,
    },
    {
      month: '2026-09',
      vacation: '380.000',
      personal: '60.000',
      sick: '70.000',
      missedClockOuts: 6,
      overtimeMinutes: 2940,
    },
    {
      month: '2026-10',
      vacation: '0.000',
      personal: '0.000',
      sick: '0.000',
      missedClockOuts: 0,
      overtimeMinutes: 0,
    },
  ],
  teams: [
    {
      team: 'engineering',
      teamName: 'Engineering',
      people: 148,
      daysTaken: '1900.000',
      overtimeMinutes: 6000,
      left: '1420.500',
    },
    {
      team: 'sales',
      teamName: 'Sales',
      people: 64,
      daysTaken: '820.000',
      overtimeMinutes: 1080,
      left: '610.000',
    },
  ],
  hiddenTeams: 3,
  people: [
    {
      personId: P(2),
      displayName: 'Adam Novak',
      teamName: 'Platform',
      left: '14.500',
      losesAtYearEnd: '9.500',
      lastDayOff: '2026-08-14',
    },
    {
      personId: P(3),
      displayName: 'Omar Haddad',
      teamName: 'Platform',
      left: '20.000',
      losesAtYearEnd: '15.000',
      lastDayOff: null,
    },
    {
      personId: P(4),
      displayName: 'Hana Kim',
      teamName: 'Platform',
      left: '8.000',
      losesAtYearEnd: '3.000',
      lastDayOff: '2026-09-02',
    },
    {
      personId: P(5),
      displayName: 'Ravi Patel',
      teamName: 'Platform',
      left: '4.000',
      losesAtYearEnd: '0.000',
      lastDayOff: '2026-04-30',
    },
    {
      personId: P(6),
      displayName: 'Leo Rossi',
      teamName: 'Platform',
      left: '2.000',
      losesAtYearEnd: '0.000',
      lastDayOff: '2026-05-08',
    },
    {
      personId: P(7),
      displayName: 'Yuki Sato',
      teamName: 'Platform',
      left: '5.000',
      losesAtYearEnd: '0.000',
      lastDayOff: null,
    },
  ],
  ...over,
});

/** T28 open over What changed: the four without a break, Yuki without a work email. */
export const adaNudging = (): InsightsData =>
  adaInsights({
    point: 'no_break',
    nudge: {
      include: { balance: true, bridge: true, losing: false },
      since: '2026-06-01',
      recipients: [
        { personId: P(6), displayName: 'Leo Rossi', reachable: true },
        { personId: P(3), displayName: 'Omar Haddad', reachable: true },
        { personId: P(5), displayName: 'Ravi Patel', reachable: true },
        { personId: P(7), displayName: 'Yuki Sato', reachable: false },
      ],
      preview: {
        personId: P(6),
        displayName: 'Leo Rossi',
        heading: 'Leo, you haven’t had a day off since June',
        lede: 'You have 2 days left this year. Taking Mon 7 Dec gives you 4 days off with Inmaculada Concepción. A few days away do more than they look. Nobody else sees this message.',
      },
    },
  });

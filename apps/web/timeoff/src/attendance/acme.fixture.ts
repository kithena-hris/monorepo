import type { ClockData } from '../clock/clock';
import type { TeamNowData } from './team-now';
import type { Punch } from './time';
import type { TimesheetData } from './timesheet';

/**
 * Acme's attendance as the demo company answers it on Thursday 1 October
 * 2026 at 12:33 in Madrid (`services/timeoff/src/seed/acme.ts`,
 * `docs/demo-company.md`). Adam's week: Monday a normal day, Tuesday an hour
 * and five minutes over, Wednesday no clock-out, and today clocked in at the
 * Madrid reader at 08:52. Marco's board: five of his six reports in, Yuki on
 * a break, Hana off sick until Friday.
 */

export const NOW = '2026-10-01T10:33:00.000Z';
const ADAM = '7ac0e000-0000-7000-8000-000000000002';

let n = 0;
/** A punch at a Madrid wall-clock time (UTC+2 until 25 October). */
const punch = (
  date: string,
  time: string,
  kind: Punch['kind'],
  source = 'badge',
  workModel: Punch['workModel'] = 'office',
): Punch => {
  n += 1;
  const [h = 0, m = 0] = time.split(':').map(Number);
  const at = `${date}T${String(h - 2).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
  return {
    id: `0199b000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    at,
    recordedAt: at,
    kind,
    source,
    workModel,
    supersedes: null,
    reason: null,
  };
};

const punches = (): Punch[] => [
  punch('2026-09-28', '08:58', 'in'),
  punch('2026-09-28', '13:05', 'break_start', 'web'),
  punch('2026-09-28', '13:50', 'break_end', 'web'),
  punch('2026-09-28', '17:41', 'out', 'web'),
  punch('2026-09-29', '09:02', 'in'),
  punch('2026-09-29', '13:30', 'break_start', 'web'),
  punch('2026-09-29', '14:10', 'break_end', 'web'),
  punch('2026-09-29', '18:47', 'out', 'web'),
  punch('2026-09-30', '08:47', 'in'),
  punch('2026-09-30', '13:12', 'break_start', 'web'),
  punch('2026-09-30', '14:02', 'break_end', 'web'),
  punch('2026-10-01', '08:52', 'in'),
];

const days = (): TimesheetData['days'] => [
  {
    date: '2026-09-28',
    status: 'complete',
    workedMinutes: 478,
    breakMinutes: 45,
    plannedMinutes: 480,
    overtimeMinutes: 0,
    segments: [
      { kind: 'worked', from: 538, to: 785 },
      { kind: 'break', from: 785, to: 830 },
      { kind: 'worked', from: 830, to: 1061 },
    ],
    flags: [],
  },
  {
    date: '2026-09-29',
    status: 'complete',
    workedMinutes: 545,
    breakMinutes: 40,
    plannedMinutes: 480,
    overtimeMinutes: 65,
    segments: [
      { kind: 'worked', from: 542, to: 810 },
      { kind: 'break', from: 810, to: 850 },
      { kind: 'worked', from: 850, to: 1062 },
      { kind: 'overtime', from: 1062, to: 1127 },
    ],
    flags: [],
  },
  {
    date: '2026-09-30',
    status: 'open',
    workedMinutes: null,
    breakMinutes: 50,
    plannedMinutes: 480,
    overtimeMinutes: 0,
    segments: [
      { kind: 'worked', from: 527, to: 792 },
      { kind: 'break', from: 792, to: 842 },
      { kind: 'missing', from: 842, to: 1057 },
    ],
    flags: [],
  },
  {
    date: '2026-10-01',
    status: 'live',
    workedMinutes: 221,
    breakMinutes: 0,
    plannedMinutes: 480,
    overtimeMinutes: 0,
    segments: [{ kind: 'live', from: 532, to: 753 }],
    flags: [],
  },
  {
    date: '2026-10-02',
    status: 'planned',
    workedMinutes: null,
    breakMinutes: 0,
    plannedMinutes: 480,
    overtimeMinutes: 0,
    segments: [{ kind: 'planned', from: 540, to: 1050 }],
    flags: [],
  },
  ...['2026-10-03', '2026-10-04'].map((date) => ({
    date,
    status: 'planned' as const,
    workedMinutes: null,
    breakMinutes: 0,
    plannedMinutes: 0,
    overtimeMinutes: 0,
    segments: [],
    flags: [],
  })),
];

const adamMember = {
  personId: ADAM,
  displayName: 'Adam Novak',
  timeZone: 'Europe/Madrid',
};

/** Adam's timesheet for the week of 28 September. */
export const adamWeek = (): TimesheetData => ({
  member: adamMember,
  days: days(),
  weeks: [{ monday: '2026-09-28', workedMinutes: 1244, plannedMinutes: 2400, overtimeMinutes: 65 }],
  open: [{ date: '2026-09-30', lastPunchAt: '2026-09-30T12:02:00.000Z' }],
  overtime: [],
  punches: punches(),
  corrections: [],
  period: { kind: 'week', from: '2026-09-28', to: '2026-10-04' },
  fix: null,
  now: NOW,
});

/** What the top bar's clock is handed for Adam: the same punches, today among them. */
export const adamClock = (): ClockData => ({
  member: adamMember,
  days: days(),
  punches: punches(),
  now: NOW,
});

const live = (from: number) => ({
  date: '2026-10-01',
  status: 'live' as const,
  workedMinutes: 753 - from,
  breakMinutes: 0,
  plannedMinutes: 480,
  overtimeMinutes: 0,
  segments: [{ kind: 'live', from, to: 753 }],
  flags: [],
});

/** Marco's board: his reports on Platform at 12:33. */
export const marcoBoard = (): TeamNowData => ({
  people: [
    {
      personId: 'p-omar',
      displayName: 'Omar Haddad',
      state: 'in',
      workModel: 'office',
      today: live(511),
    },
    {
      personId: ADAM,
      displayName: 'Adam Novak',
      state: 'in',
      workModel: 'office',
      today: live(532),
    },
    {
      personId: 'p-yuki',
      displayName: 'Yuki Sato',
      state: 'on_break',
      workModel: 'office',
      today: {
        ...live(495),
        status: 'live',
        workedMinutes: 246,
        breakMinutes: 12,
        segments: [
          { kind: 'worked', from: 495, to: 741 },
          { kind: 'break', from: 741, to: 753 },
        ],
      },
    },
    {
      personId: 'p-leo',
      displayName: 'Leo Rossi',
      state: 'in',
      workModel: 'remote',
      today: live(558),
    },
    {
      personId: 'p-ravi',
      displayName: 'Ravi Patel',
      state: 'in',
      workModel: 'remote',
      today: live(612),
    },
    {
      personId: 'p-hana',
      displayName: 'Hana Kim',
      state: 'out',
      workModel: null,
      today: {
        ...live(540),
        status: 'planned',
        workedMinutes: null,
        segments: [{ kind: 'planned', from: 540, to: 1050 }],
      },
    },
  ],
  needsYou: [
    {
      kind: 'correction',
      personId: ADAM,
      displayName: 'Adam Novak',
      date: '2026-09-30',
      minutes: null,
      punch: { kind: 'out' },
    },
    {
      kind: 'overtime',
      personId: 'p-omar',
      displayName: 'Omar Haddad',
      date: '2026-09-29',
      minutes: 90,
      punch: null,
    },
  ],
  away: [
    { personId: 'p-hana', status: 'approved', span: { from: '2026-09-30', to: '2026-10-02' } },
  ],
  now: NOW,
  sentence: {
    text: 'Everyone expected is in. Ravi started at 10:12, inside the team’s hours. Adam has an open fix from Wed 30.',
    ai: false,
  },
});

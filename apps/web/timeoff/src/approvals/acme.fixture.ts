import type { TeamCalendarData } from '../calendar/calendar';
import type { ApprovalsData } from './approvals';
import type { DecisionData } from './decision';
import type { DelegationData } from './delegation';
import {
  datesIn,
  isWeekend,
  type CalendarView,
  type LeaveTypeLook,
  type RequestItem,
  type Written,
} from './words';

/**
 * Acme's Platform team as Marco Ruiz, its manager, sees it on Thursday
 * 1 October 2026 at 12:33 in Madrid (`services/timeoff/src/seed/acme.ts`,
 * the design's T12–T19): Omar off 19–21 October and Yuki on the 21st, so
 * Adam's 19–23 October would leave 4 of 7 in on Wednesday 21 against a
 * minimum of 5; Leo, Ravi and Hana clear to approve; Omar's December below
 * zero.
 */

const person = (n: number): string => `7ac0e000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const request = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const acme = {
  marco: person(1),
  adam: person(2),
  omar: person(3),
  yuki: person(4),
  leo: person(5),
  hana: person(6),
  ravi: person(7),
};

const NAMES: Record<string, string> = {
  [acme.marco]: 'Marco Ruiz',
  [acme.adam]: 'Adam Novak',
  [acme.omar]: 'Omar Haddad',
  [acme.yuki]: 'Yuki Sato',
  [acme.leo]: 'Leo Rossi',
  [acme.hana]: 'Hana Kim',
  [acme.ravi]: 'Ravi Patel',
};

export const NOW = '2026-10-01T10:33:00.000Z';

export const types: readonly LeaveTypeLook[] = [
  { key: 'vacation', name: 'Vacation', colorToken: 'chart-1', icon: 'sun' },
  { key: 'personal', name: 'Personal day', colorToken: 'chart-2', icon: 'coffee' },
  { key: 'sick', name: 'Sick', colorToken: 'chart-5', icon: 'thermometer' },
  { key: 'comp', name: 'Comp time', colorToken: 'chart-4', icon: 'timer' },
];

const TYPE_NAMES: Record<string, [string, string]> = {
  vacation: ['Vacation', 'vacation'],
  personal: ['Personal day', 'other'],
  sick: ['Sick', 'sick'],
  comp: ['Comp time', 'other'],
};

function item(
  n: number,
  who: string,
  type: string,
  from: string,
  to: string,
  days: string,
  requestedAt: string,
  status = 'pending',
): RequestItem {
  const [leaveTypeName, category] = TYPE_NAMES[type] ?? [type, 'other'];
  return {
    requestId: request(n),
    personId: who,
    displayName: NAMES[who] ?? '',
    leaveTypeKey: type,
    leaveTypeName,
    category,
    status,
    span: { from, to, startsHalfDay: false, endsHalfDay: false },
    spans: [{ from, to }],
    workingDays: days,
    requestedAt,
    waitingOn: status === 'pending' ? 'manager' : null,
  };
}

export const leo = item(
  21,
  acme.leo,
  'vacation',
  '2026-10-26',
  '2026-10-30',
  '5.000',
  '2026-09-30T09:12:00.000Z',
);
export const ravi = item(
  22,
  acme.ravi,
  'comp',
  '2026-10-09',
  '2026-10-09',
  '1.000',
  '2026-09-30T15:40:00.000Z',
);
export const hana = item(
  23,
  acme.hana,
  'sick',
  '2026-10-01',
  '2026-10-02',
  '2.000',
  '2026-10-01T06:10:00.000Z',
);
export const adam = item(
  24,
  acme.adam,
  'vacation',
  '2026-10-19',
  '2026-10-23',
  '5.000',
  '2026-09-30T14:02:00.000Z',
);
export const omar = item(
  25,
  acme.omar,
  'vacation',
  '2026-12-14',
  '2026-12-23',
  '8.000',
  '2026-09-29T11:00:00.000Z',
);

/** A line as Time Off's template wrote it; `ai` for one a model wrote. */
export const written = (text: string, ai = false): Written => ({ text, ai });

/** T16: Marco's Waiting for me. */
export const waiting = (): ApprovalsData => ({
  tab: 'waiting',
  clear: [leo, ravi, hana],
  lookCloser: [
    { item: adam, reason: { rule: 'below_minimum', amount: null, days: ['2026-10-21'] } },
    { item: omar, reason: { rule: 'below_zero', amount: '1.500', days: [] } },
  ],
  items: [],
  why: [
    { requestId: leo.requestId, text: written('Team stays at 5 of 7. Leo has 14 days left.') },
    { requestId: ravi.requestId, text: written('Uses 8h of the 11h Ravi has banked.') },
    {
      requestId: hana.requestId,
      text: written('Self-certified, under the days that need a note.'),
    },
    { requestId: adam.requestId, text: written('Below the team minimum on Wed 21 Oct.') },
    {
      requestId: omar.requestId,
      text: written('Would take Omar to −1.5 days. Needs HR after you.'),
    },
  ],
  types,
  now: NOW,
  decision: null,
});

/** Who on Platform is off in October, as Time Off holds it once Adam has asked. */
const OCTOBER: readonly [string, string, string, string, string][] = [
  // [who, type, from, to, status]
  [acme.hana, 'sick', '2026-10-01', '2026-10-02', 'approved'],
  [acme.ravi, 'comp', '2026-10-09', '2026-10-09', 'approved'],
  [acme.marco, 'vacation', '2026-10-13', '2026-10-16', 'approved'],
  [acme.omar, 'vacation', '2026-10-19', '2026-10-21', 'approved'],
  [acme.yuki, 'personal', '2026-10-21', '2026-10-21', 'approved'],
  [acme.adam, 'vacation', '2026-10-19', '2026-10-23', 'pending'],
  [acme.leo, 'vacation', '2026-10-26', '2026-10-30', 'approved'],
];

/** Platform's calendar from `from` to `to`, with "N of 7 in" every working day. */
export function platform(from: string, to: string): CalendarView {
  const entries = OCTOBER.filter(([, , a, b]) => b >= from && a <= to).map(
    ([personId, leaveTypeKey, a, b, status], index) => ({
      requestId: personId === acme.adam ? adam.requestId : request(index + 1),
      personId,
      span: { from: a, to: b, startsHalfDay: false, endsHalfDay: false },
      status,
      leaveTypeKey,
    }),
  );
  const holidays = [{ date: '2026-10-12', name: 'Fiesta Nacional', locationKey: 'madrid' }].filter(
    (h) => h.date >= from && h.date <= to,
  );
  const coverage = datesIn(from, to).map((date) => {
    const working = !isWeekend(date) && !holidays.some((h) => h.date === date);
    const off = new Set(
      entries.filter((e) => e.span.from <= date && date <= e.span.to).map((e) => e.personId),
    );
    const present = working ? 7 - off.size : 0;
    return {
      date,
      in: present,
      of: 7,
      required: 5,
      checked: working,
      below: working && present < 5,
    };
  });
  return {
    from,
    to,
    people: Object.values(acme).map((personId) => ({
      personId,
      displayName: NAMES[personId] ?? '',
      teamKey: 'platform',
      teamName: 'Platform',
    })),
    entries,
    holidays,
    coverage,
  };
}

const day21 = { date: '2026-10-21', in: 4, of: 7, required: 5, checked: true, below: true };
const cover = (dates: readonly string[]) =>
  platform('2026-10-01', '2026-11-30').coverage.filter((c) => dates.includes(c.date));

/** T17: Adam's 19–23 October, with the fixes the domain ranks for Wednesday 21. */
export const adamsDecision = (): DecisionData => ({
  request: adam,
  member: {
    personId: acme.adam,
    displayName: 'Adam Novak',
    firstName: 'Adam',
    teamName: 'Platform',
    timeZone: 'Europe/Madrid',
  },
  balance: { before: '11.500', after: '6.500' },
  belowMinimum: [day21],
  triage: {
    group: 'look_closer',
    reason: { rule: 'below_minimum', amount: null, days: ['2026-10-21'] },
  },
  othersOff: [
    {
      personId: acme.omar,
      displayName: 'Omar Haddad',
      leaveTypeKey: 'vacation',
      span: { from: '2026-10-19', to: '2026-10-21', startsHalfDay: false, endsHalfDay: false },
    },
    {
      personId: acme.yuki,
      displayName: 'Yuki Sato',
      leaveTypeKey: 'personal',
      span: { from: '2026-10-21', to: '2026-10-21', startsHalfDay: false, endsHalfDay: false },
    },
  ],
  canDecide: true,
  lastTaken: { from: '2026-09-04', to: '2026-09-04' },
  alternatives: [
    {
      kind: 'swap_days',
      affects: 'requester',
      dates: ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23', '2026-10-26'],
      spans: [
        { from: '2026-10-19', to: '2026-10-20' },
        { from: '2026-10-22', to: '2026-10-26' },
      ],
      coverage: [
        { date: '2026-10-19', in: 5, of: 7, required: 5, checked: true, below: false },
        { date: '2026-10-20', in: 5, of: 7, required: 5, checked: true, below: false },
        { date: '2026-10-22', in: 6, of: 7, required: 5, checked: true, below: false },
        { date: '2026-10-23', in: 6, of: 7, required: 5, checked: true, below: false },
        { date: '2026-10-26', in: 5, of: 7, required: 5, checked: true, below: false },
      ],
      swapped: { out: ['2026-10-21'], in: ['2026-10-26'] },
      teammate: null,
      absence: null,
      message: written(
        'Hi Adam, could you swap Wed 21 for Mon 26? Omar and Yuki are out on the day you asked. Happy to approve straight away if that works.',
      ),
    },
    {
      kind: 'next_clean_week',
      affects: 'requester',
      dates: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'],
      spans: [{ from: '2026-10-26', to: '2026-10-30' }],
      coverage: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map(
        (date) => ({ date, in: 5, of: 7, required: 5, checked: true, below: false }),
      ),
      swapped: null,
      teammate: null,
      absence: null,
      message: written(
        'Hi Adam, could you take 26–30 Oct instead? Omar and Yuki are out on the day you asked. Happy to approve straight away if that works.',
      ),
    },
    {
      kind: 'approve_as_asked',
      affects: 'nobody',
      dates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
      spans: [{ from: '2026-10-19', to: '2026-10-23' }],
      coverage: cover(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']),
      swapped: null,
      teammate: null,
      absence: null,
      message: null,
    },
    {
      kind: 'ask_teammate',
      affects: 'teammate',
      dates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
      spans: [{ from: '2026-10-19', to: '2026-10-23' }],
      coverage: cover(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']).map(
        (c) => (c.date === '2026-10-21' ? { ...c, in: 5, below: false } : c),
      ),
      swapped: null,
      teammate: { personId: acme.yuki, displayName: 'Yuki Sato' },
      absence: { from: '2026-10-21', to: '2026-10-21' },
      message: null,
    },
  ],
  whatToKnow: written('This might be fine if 4 people can cover on Wed 21.'),
  clash: written(
    'Adam’s request would leave 4 of 7 in. Here are 3 ways to keep 5, with what each one costs.',
  ),
  team: platform('2026-10-12', '2026-10-26'),
});

/** T17: the same queue, Adam's request open beside it. */
export const deciding = (): ApprovalsData => ({ ...waiting(), decision: adamsDecision() });

/** Coming up: what Marco approved that is still ahead. */
export const comingUp = (): ApprovalsData => ({
  ...waiting(),
  tab: 'coming_up',
  clear: [],
  lookCloser: [],
  items: [
    item(
      1,
      acme.omar,
      'vacation',
      '2026-10-19',
      '2026-10-21',
      '3.000',
      '2026-09-15T08:00:00.000Z',
      'approved',
    ),
    item(
      2,
      acme.yuki,
      'personal',
      '2026-10-21',
      '2026-10-21',
      '1.000',
      '2026-09-22T08:00:00.000Z',
      'approved',
    ),
  ],
});

/** T19: Marco, with no delegate yet; Nora Becker above him. */
export const delegation = (): DelegationData => ({
  approverId: acme.marco,
  escalatesTo: { personId: person(8), displayName: 'Nora Becker' },
  delegation: null,
  candidates: Object.values(acme)
    .filter((id) => id !== acme.marco)
    .map((personId) => ({ personId, displayName: NAMES[personId] ?? '' })),
  coveringFor: [],
});

/** T12: October as a month, Platform, Madrid's holiday on the 12th. */
export const october = (view: TeamCalendarData['view'] = 'month'): TeamCalendarData => ({
  view,
  scope: 'team',
  teamKey: null,
  month: '2026-10',
  week: '2026-09-28',
  year: 2026,
  today: '2026-10-01',
  calendar: platform('2026-09-28', '2026-10-31'),
  days: null,
  types,
  clash: view === 'timeline' ? adamsDecision() : null,
});

/** The year: how many are off each day. */
export const year = (): TeamCalendarData => ({
  ...october('year'),
  calendar: null,
  days: platform('2026-10-01', '2026-10-31')
    .coverage.filter((c) => c.checked && c.in < 7)
    .map((c) => ({ date: c.date, off: 7 - c.in })),
  clash: null,
});

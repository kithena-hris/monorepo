import { adam } from '../overview/acme.fixture';
import type { RequestData } from './request';

/**
 * Adam's request panel at Acme on Thursday 1 October 2026
 * (`services/timeoff/src/seed/acme.ts`): T3 with 19–23 October chosen — 5
 * working days, 9 away, 11.5 → 6.5, and Wednesday 21 down to 4 of 7 with Omar
 * and Yuki off — and T5, 14–23 December once that is booked: 8 days from
 * 6.5, so 1.5 borrowed from 2027, Marco then HR.
 */

const span = (from: string, to: string) => ({
  from,
  to,
  startsHalfDay: false,
  endsHalfDay: false,
});

const leaveTypes: RequestData['leaveTypes'] = [
  {
    key: 'vacation',
    name: 'Vacation',
    category: 'annual_leave',
    unit: 'day',
    tracked: true,
    colorToken: 'chart-1',
    icon: 'sun',
    left: '11.500',
  },
  {
    key: 'personal',
    name: 'Personal day',
    category: 'other',
    unit: 'day',
    tracked: true,
    colorToken: 'chart-2',
    icon: 'coffee',
    left: '2.000',
  },
  {
    key: 'comp',
    name: 'Comp time',
    category: 'other',
    unit: 'hour',
    tracked: true,
    colorToken: 'chart-4',
    icon: 'timer',
    left: '6.000',
  },
  {
    key: 'sick',
    name: 'Sick',
    category: 'sick_leave',
    unit: 'day',
    tracked: false,
    colorToken: 'neutral',
    icon: 'thermometer',
    left: null,
  },
  {
    key: 'birth',
    name: 'Birth and childcare',
    category: 'parental_leave',
    unit: 'day',
    tracked: false,
    colorToken: 'chart-5',
    icon: 'baby',
    left: null,
  },
];

const team: NonNullable<RequestData['team']> = {
  people: [
    { personId: '7ac0e000-0000-7000-8000-000000000001', displayName: 'Marco Ruiz' },
    { personId: '7ac0e000-0000-7000-8000-000000000002', displayName: 'Adam Novak' },
    { personId: '7ac0e000-0000-7000-8000-000000000003', displayName: 'Omar Haddad' },
    { personId: '7ac0e000-0000-7000-8000-000000000004', displayName: 'Yuki Sato' },
    { personId: '7ac0e000-0000-7000-8000-000000000005', displayName: 'Leo Rossi' },
    { personId: '7ac0e000-0000-7000-8000-000000000006', displayName: 'Hana Kim' },
  ],
  entries: [
    {
      personId: '7ac0e000-0000-7000-8000-000000000006',
      leaveTypeKey: null,
      span: span('2026-10-01', '2026-10-02'),
    },
    {
      personId: '7ac0e000-0000-7000-8000-000000000003',
      leaveTypeKey: 'vacation',
      span: span('2026-10-19', '2026-10-21'),
    },
    {
      personId: '7ac0e000-0000-7000-8000-000000000004',
      leaveTypeKey: 'personal',
      span: span('2026-10-21', '2026-10-21'),
    },
    {
      personId: '7ac0e000-0000-7000-8000-000000000005',
      leaveTypeKey: 'vacation',
      span: span('2026-10-26', '2026-10-30'),
    },
  ],
  coverage: [],
};

const marco = { personId: '7ac0e000-0000-7000-8000-000000000001', displayName: 'Marco Ruiz' };

/** T3 before anything is chosen: the types, the month, nothing to cost yet. */
export const opening = (): RequestData => ({
  overview: adam(),
  leaveTypes,
  preview: null,
  asked: { type: null, from: null, to: null, half: false, step: null, month: '2026-10' },
  team,
  holidays: [{ date: '2026-10-12', name: 'Fiesta Nacional' }],
  today: '2026-10-01',
  problem: null,
});

/** T3: vacation, 19–23 October. */
export const october = (): RequestData => ({
  ...opening(),
  asked: {
    type: 'vacation',
    from: '2026-10-19',
    to: '2026-10-23',
    half: false,
    step: null,
    month: '2026-10',
  },
  preview: {
    span: { ...span('2026-10-19', '2026-10-23'), workingDays: '5.000' },
    daysAway: { days: '9.000', from: '2026-10-17', to: '2026-10-25' },
    balance: { before: '11.500', after: '6.500' },
    belowMinimum: [{ date: '2026-10-21', in: 4, of: 7, required: 5, below: true }],
    blocked: false,
    approvers: ['manager'],
    approver: marco,
    negative: {
      kind: 'fits',
      days: null,
      limit: null,
      nextYearStartsAt: null,
      approvers: [],
      unpaid: null,
      shorten: null,
    },
  },
});

/** T5: vacation, 14–23 December, with 19–23 October already booked. */
export const december = (): RequestData => ({
  ...opening(),
  team: { ...team, entries: [] },
  holidays: [
    { date: '2026-12-08', name: 'Inmaculada Concepción' },
    { date: '2026-12-25', name: 'Navidad' },
  ],
  asked: {
    type: 'vacation',
    from: '2026-12-14',
    to: '2026-12-23',
    half: false,
    step: null,
    month: '2026-12',
  },
  preview: {
    span: { ...span('2026-12-14', '2026-12-23'), workingDays: '8.000' },
    daysAway: { days: '10.000', from: '2026-12-12', to: '2026-12-23' },
    balance: { before: '6.500', after: '-1.500' },
    belowMinimum: [],
    blocked: false,
    approvers: ['manager', 'hr'],
    approver: marco,
    negative: {
      kind: 'borrow',
      days: '1.500',
      limit: null,
      nextYearStartsAt: '23.500',
      approvers: ['manager', 'hr'],
      unpaid: { days: '1.500' },
      shorten: { to: '2026-12-22', endsHalfDay: true, days: '6.500' },
    },
  },
});

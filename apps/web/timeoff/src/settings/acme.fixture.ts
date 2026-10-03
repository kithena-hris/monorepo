import type { ApprovalSettingsData } from './approval-settings';
import type { AttendanceSettingsData } from './attendance-settings';
import type { HolidaySettingsData } from './holiday-settings';
import type { LeaveTypeData, PolicyDefinition } from './leave-type';
import type { LeaveTypesData } from './leave-types';
import type { NegativeBalanceData } from './negative-balance';
import type { ApprovalRule, LeaveTypeDefinition, LeaveTypeRow, Pack, Predicate } from './shared';

/**
 * Acme's Time Off settings as Time Off answers them for Ada, HR (the seed in
 * `services/timeoff/src/seed/acme.ts`): Spain's statutory types beside Acme's
 * personal days and comp time, vacation by tenure in Spain, Madrid's holidays
 * and Platform's minimum. Ids are fixed so a test can name them.
 */

export const VACATION_POLICY = '7ac0e000-0000-7000-8000-000000000100';
export const PERSONAL_POLICY = '7ac0e000-0000-7000-8000-000000000101';
export const ADAM = '0199a000-0000-7000-8000-000000000002';
export const MARCO = '0199a000-0000-7000-8000-000000000001';
export const HANA = '0199a000-0000-7000-8000-000000000006';

const spain: Predicate = { combine: 'all', clauses: [{ operand: 'country', in: ['ES'] }] };
const spainPack: Pack = { country: 'ES', version: 1, reviewed: false };

const type = (
  key: string,
  name: string,
  rest: Partial<LeaveTypeDefinition>,
  row: Partial<LeaveTypeRow> = {},
): LeaveTypeRow => ({
  definition: {
    key,
    name: { default: name },
    category: 'other',
    colorToken: 'fg-3',
    icon: 'plane',
    unit: 'day',
    tracked: false,
    paid: 'paid',
    visibility: 'type',
    requiresNote: null,
    appliesTo: null,
    statutory: true,
    ...rest,
  },
  hidden: false,
  deleted: false,
  policyIds: [],
  ...row,
});

export const leaveTypeRows = (): LeaveTypeRow[] => [
  type(
    'vacation',
    'Vacation',
    { category: 'annual_leave', colorToken: 'chart-1', icon: 'sun', tracked: true },
    { policyIds: [VACATION_POLICY] },
  ),
  type('sick', 'Sick', {
    category: 'sick_leave',
    colorToken: 'chart-5',
    icon: 'thermometer',
    paid: 'statutory',
    visibility: 'off_only',
    requiresNote: { afterDays: 3 },
  }),
  type('parental', 'Parental leave', {
    category: 'parental_leave',
    colorToken: 'chart-3',
    icon: 'baby',
    paid: 'statutory',
    visibility: 'off_only',
  }),
  type('parental_unpaid', 'Parental leave, unpaid', {
    category: 'parental_leave',
    colorToken: 'chart-6',
    icon: 'circle-slash',
    paid: 'unpaid',
    visibility: 'off_only',
  }),
  type('bereavement', 'Bereavement', { visibility: 'off_only' }),
  type('moving', 'Moving home', {}, { hidden: true }),
  type(
    'personal',
    'Personal day',
    { colorToken: 'chart-2', icon: 'coffee', tracked: true, statutory: false },
    { policyIds: [PERSONAL_POLICY] },
  ),
  type('comp', 'Comp time', {
    colorToken: 'chart-4',
    icon: 'timer',
    unit: 'hour',
    tracked: true,
    statutory: false,
  }),
];

export const approvalRules = (): ApprovalRule[] => [
  { subject: 'request', leaveTypes: null, when: 'always', approvers: ['manager'] },
  { subject: 'request', leaveTypes: null, when: 'below_zero', approvers: ['manager', 'hr'] },
  { subject: 'plan', leaveTypes: ['parental'], when: 'always', approvers: ['hr'] },
];

/** T29. */
export const leaveTypes = (): LeaveTypesData => ({
  leaveTypes: leaveTypeRows(),
  packs: [spainPack],
  rules: approvalRules(),
});

/* ---------------------------------------------------------------- T30 -- */

export const vacationDefinition = (over: Partial<PolicyDefinition> = {}): PolicyDefinition => ({
  leaveTypeKey: 'vacation',
  allowance: [
    { fromYears: 0, days: '25.000' },
    { fromYears: 3, days: '26.000' },
    { fromYears: 6, days: '27.000' },
    { fromYears: 10, days: '28.000' },
  ],
  year: { month: 1, day: 1 },
  earning: 'monthly' as const,
  proRata: true,
  keepEarningOnParental: true,
  probationMonths: 0,
  carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } },
  requests: { halfDays: true, showWhoIsOff: true, blockBelowMinimum: false },
  negativeBalance: {
    limit: '3.000',
    approvers: 'manager_then_hr' as const,
    atYearEnd: 'next_year' as const,
    onLeaving: 'final_pay' as const,
  },
  appliesTo: spain,
  ...over,
});

const pair = (current: string, draft: string) => ({ current, draft });

/** T30 with a draft that lowers the carry-over to 3 and adds a 29-day band at 15 years. */
export const vacationWithDraft = (): LeaveTypeData => {
  const [vacation] = leaveTypeRows();
  if (vacation === undefined) throw new Error('no vacation');
  return {
    leaveType: vacation,
    policies: [
      {
        id: VACATION_POLICY,
        versions: [
          {
            version: 1,
            status: 'published' as const,
            effectiveFrom: '2026-01-01',
            definition: vacationDefinition(),
          },
          {
            version: 2,
            status: 'draft' as const,
            effectiveFrom: null,
            definition: vacationDefinition({
              allowance: [
                { fromYears: 0, days: '25.000' },
                { fromYears: 3, days: '26.000' },
                { fromYears: 6, days: '27.000' },
                { fromYears: 10, days: '28.000' },
                { fromYears: 15, days: '29.000' },
              ],
              carryOver: { maxDays: '3.000', useBy: { month: 3, day: 31 } },
            }),
          },
        ],
      },
    ],
    policyId: VACATION_POLICY,
    preview: {
      draftVersion: 2,
      effectiveFrom: '2026-01-01',
      yearEnd: '2026-12-31',
      members: [
        {
          personId: ADAM,
          displayName: 'Adam Novak',
          allowance: pair('25.000', '25.000'),
          left: pair('14.500', '14.500'),
          lostAtYearEnd: pair('9.500', '11.500'),
        },
        {
          personId: HANA,
          displayName: 'Hana Kim',
          allowance: pair('28.000', '29.000'),
          left: pair('8.000', '9.000'),
          lostAtYearEnd: pair('3.000', '6.000'),
        },
        {
          personId: MARCO,
          displayName: 'Marco Ruiz',
          allowance: pair('27.000', '27.000'),
          left: pair('2.000', '2.000'),
          lostAtYearEnd: pair('0.000', '0.000'),
        },
      ],
      shadow: null,
    },
    as: null as string | null,
  };
};

/** T30's draft two weeks into its shadow run (TOF-093): Hana's 15-year band is a day ahead. */
export const vacationShadowing = (): LeaveTypeData => {
  const data = vacationWithDraft();
  if (data.preview === null) throw new Error('no preview');
  return {
    ...data,
    preview: {
      ...data.preview,
      shadow: {
        from: '2026-10-01',
        to: '2026-10-31',
        asOf: '2026-10-15',
        members: [
          {
            personId: ADAM,
            displayName: 'Adam Novak',
            credited: pair('25.000', '25.000'),
            balance: pair('14.500', '14.500'),
          },
          {
            personId: HANA,
            displayName: 'Hana Kim',
            credited: pair('28.000', '29.000'),
            balance: pair('8.000', '9.000'),
          },
          {
            personId: MARCO,
            displayName: 'Marco Ruiz',
            credited: pair('27.000', '27.000'),
            balance: pair('2.000', '2.000'),
          },
        ],
      },
    },
  };
};

/** T30 with nothing drafted: the published version, no preview. */
export const vacationPublished = (): LeaveTypeData => {
  const data = vacationWithDraft();
  const [policy] = data.policies;
  if (policy === undefined) throw new Error('no policy');
  return {
    ...data,
    policies: [{ ...policy, versions: policy.versions.slice(0, 1) }],
    preview: null,
  };
};

/* ---------------------------------------------------------------- T31 -- */

export const negativeBalance = (): NegativeBalanceData => ({
  policies: [
    {
      policyId: VACATION_POLICY,
      leaveTypeKey: 'vacation',
      leaveTypeName: 'Vacation',
      version: 1,
      status: 'published' as const,
      rule: {
        limit: '3.000',
        approvers: 'manager_then_hr',
        atYearEnd: 'next_year',
        onLeaving: 'final_pay',
      },
    },
    {
      policyId: PERSONAL_POLICY,
      leaveTypeKey: 'personal',
      leaveTypeName: 'Personal day',
      version: 1,
      status: 'published' as const,
      rule: null,
    },
  ],
});

/* ---------------------------------------------------------------- T33 -- */

export const attendance = (): AttendanceSettingsData => ({
  rules: {
    breakAfterMinutes: 360,
    breakMinutes: 30,
    restMinutes: 720,
    weeklyMaxMinutes: 2520,
    overtime: { becomes: 'choose' as const, multiplier: '1.25' },
  },
  // 09:00–17:30 Monday to Friday, half an hour's break: Time Off's DEFAULT_SCHEDULE.
  defaultSchedule: {
    kind: 'fixed',
    name: 'Standard',
    week: Object.fromEntries(
      ['1', '2', '3', '4', '5'].map((d) => [d, { start: 540, end: 1050, breakMinutes: 30 }]),
    ),
  },
});

/* ---------------------------------------------------------------- T34 -- */

export const approvals = (): ApprovalSettingsData => ({
  rules: approvalRules(),
  autoApproval: { shortenOrCancel: true, sickUnderDays: 3, oneDayAboveMinimum: false },
  teams: [
    { teamKey: 'platform', teamName: 'Platform', minimum: { atLeast: 5, unit: 'people' as const } },
    { teamKey: 'support', teamName: 'Support', minimum: { atLeast: 60, unit: 'percent' as const } },
    { teamKey: 'sales', teamName: 'Sales', minimum: null },
  ],
  leaveTypes: leaveTypeRows(),
});

/* ---------------------------------------------------------------- T36 -- */

const layer = (
  key: string,
  name: string,
  level: 'national' | 'regional' | 'city',
  holidays: readonly (readonly [string, string])[],
) => ({
  key,
  name,
  level,
  weekendRule: 'none' as const,
  holidays: holidays.map(([date, n]) => ({ date, name: n })),
});

const madridDays: readonly (readonly [string, string, string])[] = [
  ['2026-01-01', 'Año Nuevo', 'es'],
  ['2026-01-06', 'Epifanía', 'es'],
  ['2026-04-02', 'Jueves Santo', 'es_md'],
  ['2026-04-03', 'Viernes Santo', 'es'],
  ['2026-05-01', 'Fiesta del Trabajo', 'es'],
  ['2026-05-02', 'Fiesta de la Comunidad de Madrid', 'es_md'],
  ['2026-05-15', 'San Isidro', 'madrid'],
  ['2026-08-15', 'Asunción', 'es'],
  ['2026-10-12', 'Fiesta Nacional', 'es'],
  ['2026-11-02', 'Todos los Santos (trasladado)', 'es_md'],
  ['2026-11-09', 'La Almudena', 'madrid'],
  ['2026-12-07', 'Día de la Constitución (trasladado)', 'es_md'],
  ['2026-12-08', 'Inmaculada Concepción', 'es'],
  ['2026-12-25', 'Navidad', 'es'],
];

export const holidays = (): HolidaySettingsData => ({
  year: 2026,
  thisYear: 2026,
  location: null as string | null,
  packs: [spainPack],
  layers: [
    layer(
      'es',
      'Spain',
      'national',
      madridDays.filter((d) => d[2] === 'es').map(([a, b]) => [a, b]),
    ),
    layer(
      'es_md',
      'Madrid region',
      'regional',
      madridDays.filter((d) => d[2] === 'es_md').map(([a, b]) => [a, b]),
    ),
    layer(
      'madrid',
      'Madrid city',
      'city',
      madridDays.filter((d) => d[2] === 'madrid').map(([a, b]) => [a, b]),
    ),
    layer('es_ct', 'Catalonia', 'regional', [['2026-09-11', 'Diada Nacional de Catalunya']]),
    layer('barcelona', 'Barcelona city', 'city', [['2026-09-24', 'La Mercè']]),
  ],
  locations: [
    {
      locationKey: 'barcelona',
      layerKeys: ['es', 'es_ct', 'barcelona'],
      holidays: [
        { date: '2026-01-01', name: 'Año Nuevo', layer: 'es', movedFrom: null },
        {
          date: '2026-09-11',
          name: 'Diada Nacional de Catalunya',
          layer: 'es_ct',
          movedFrom: null,
        },
        { date: '2026-09-24', name: 'La Mercè', layer: 'barcelona', movedFrom: null },
      ],
    },
    {
      locationKey: 'madrid',
      layerKeys: ['es', 'es_md', 'madrid'],
      holidays: madridDays.map(([date, name, l]) => ({ date, name, layer: l, movedFrom: null })),
    },
  ],
});

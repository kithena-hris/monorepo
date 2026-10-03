import { fixedClock, ok, type Result } from '@kithena/domain-kit';
import {
  CalendarDate,
  DayAmount,
  Instant,
  LeaveTypeDefinition,
  LocationKey,
  PersonId,
  PolicyDefinition,
  TeamKey,
  type LeaveTypeKey,
  type TenantId,
} from '@kithena/contracts';

import { upsertIn } from '../application/member/sync.js';
import { MemberFields, type Tx, type UnitOfWork } from '../application/ports.js';
import { persist } from '../application/request/request.js';
import { adjustedEvents, post, transact } from '../application/shared.js';
import { es } from '../country-packs/es.js';
import type { Schedule } from '../domain/attendance/schedule.js';
import { entry } from '../domain/balance/ledger.js';
import type { EventContext } from '../domain/context.js';
import { addDays } from '../domain/days.js';
import { LeaveType } from '../domain/policy/leave-type.js';
import { Policy, policyId } from '../domain/policy/policy.js';
import { LeaveRequest, leaveRequestId } from '../domain/request/leave-request.js';

/**
 * Acme's Platform team in the design's October 2026 (TOF-049): the people,
 * the Spanish policies, Madrid's holidays, the team minimum, schedules, the
 * year's requests and Adam's week of 28 September — so `just dev` opens on
 * the screens as drawn. `docs/demo-company.md` lists what is here and why.
 *
 * Written as of Thursday 1 October 2026, 12:33 in Madrid, the design's
 * "today", through the domain and the application's own functions: members
 * by the import's path, accruals by the hire's, requests by the aggregate's
 * transitions, each at the date it happened. One transaction, and skipped
 * whole when Adam is already there, so running it twice changes nothing.
 *
 * Adam's numbers are T1's: 11.5 days of vacation left of 25, 10.5 used and 3
 * booked; 2 personal days of 3; 6 hours of comp time. His 19–23 October is
 * not here: it is the request T3 shows him sending (11.5 → 6.5, and
 * Wednesday 21 down to 4 of 7), and the calendar and the queue show it once
 * he has.
 */

export const SEEDED_AT = '2026-10-01T10:33:00.000Z';

const person = (n: number): PersonId =>
  PersonId.parse(`7ac0e000-0000-7000-8000-${String(n).padStart(12, '0')}`);

/** The team, Marco first: he manages the other six. */
export const team = {
  marco: person(1),
  adam: person(2),
  omar: person(3),
  yuki: person(4),
  leo: person(5),
  hana: person(6),
  ravi: person(7),
};

const roster: readonly (readonly [keyof typeof team, string, string])[] = [
  ['marco', 'Marco Ruiz', '2019-05-06'],
  ['adam', 'Adam Novak', '2024-03-04'],
  ['omar', 'Omar Haddad', '2021-09-01'],
  ['yuki', 'Yuki Sato', '2023-01-09'],
  ['leo', 'Leo Rossi', '2022-06-01'],
  ['hana', 'Hana Kim', '2020-02-03'],
  ['ravi', 'Ravi Patel', '2025-04-01'],
];

const PLATFORM = TeamKey.parse('platform');
const MADRID = LocationKey.parse('madrid');
const key = (k: string): LeaveTypeKey => LeaveTypeDefinition.shape.key.parse(k);
const VACATION = key('vacation');
const PERSONAL = key('personal');
const COMP = key('comp');
const SICK = key('sick');

/** Acme's own two types beside Spain's statutory ones. */
const ownTypes = [
  LeaveTypeDefinition.parse({
    key: PERSONAL,
    name: { default: 'Personal day', translations: { es: 'Asuntos propios' } },
    category: 'other',
    colorToken: 'chart-2',
    icon: 'coffee',
    tracked: true,
    paid: 'paid',
    visibility: 'type',
  }),
  LeaveTypeDefinition.parse({
    key: COMP,
    name: { default: 'Comp time', translations: { es: 'Horas compensadas' } },
    category: 'other',
    colorToken: 'chart-4',
    icon: 'timer',
    unit: 'hour',
    tracked: true,
    paid: 'paid',
    visibility: 'type',
  }),
];

const spain = { combine: 'all', clauses: [{ operand: 'country', in: ['ES'] }] };

/** Vacation by tenure (T30), a twelfth a month, 5 carried to 31 March, 3 below zero. */
const vacationPolicy = PolicyDefinition.parse({
  leaveTypeKey: VACATION,
  allowance: [
    { fromYears: 0, days: '25.000' },
    { fromYears: 3, days: '26.000' },
    { fromYears: 6, days: '27.000' },
    { fromYears: 10, days: '28.000' },
  ],
  earning: 'monthly',
  carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } },
  negativeBalance: { limit: '3.000', approvers: 'manager_then_hr' },
  appliesTo: spain,
});

const personalPolicy = PolicyDefinition.parse({
  leaveTypeKey: PERSONAL,
  allowance: [{ fromYears: 0, days: '3.000' }],
  appliesTo: spain,
});

/** 09:00–17:30 Monday to Friday, half an hour's break. */
const officeHours: Schedule = {
  kind: 'fixed',
  name: 'Office hours',
  week: Object.fromEntries(
    [1, 2, 3, 4, 5].map((d) => [d, { start: 540, end: 1050, breakMinutes: 30 }]),
  ),
};

interface Past {
  readonly who: keyof typeof team;
  readonly type: LeaveTypeKey;
  readonly from: string;
  readonly to: string;
  readonly days: string;
  readonly half?: boolean;
  readonly requested: string;
  /** `taken` once its last day passed before 1 October. */
  readonly status: 'approved' | 'taken';
}

/**
 * The design's `OFF` for October (to-web.js), Adam's year behind T1's
 * numbers, and his three booked days in November.
 */
const requests: readonly Past[] = [
  // Adam: 10.5 taken (the 5 in February use up what he carried in), 3 booked.
  {
    who: 'adam',
    type: VACATION,
    from: '2026-02-16',
    to: '2026-02-20',
    days: '5.000',
    requested: '2026-01-19',
    status: 'taken',
  },
  {
    who: 'adam',
    type: VACATION,
    from: '2026-07-10',
    to: '2026-07-10',
    days: '0.500',
    half: true,
    requested: '2026-06-15',
    status: 'taken',
  },
  {
    who: 'adam',
    type: VACATION,
    from: '2026-08-03',
    to: '2026-08-07',
    days: '5.000',
    requested: '2026-06-01',
    status: 'taken',
  },
  {
    who: 'adam',
    type: PERSONAL,
    from: '2026-09-04',
    to: '2026-09-04',
    days: '1.000',
    requested: '2026-08-28',
    status: 'taken',
  },
  {
    who: 'adam',
    type: VACATION,
    from: '2026-11-10',
    to: '2026-11-12',
    days: '3.000',
    requested: '2026-09-21',
    status: 'approved',
  },
  // October, as T12 and T13 draw it.
  {
    who: 'marco',
    type: VACATION,
    from: '2026-10-13',
    to: '2026-10-16',
    days: '4.000',
    requested: '2026-09-10',
    status: 'approved',
  },
  {
    who: 'omar',
    type: VACATION,
    from: '2026-10-19',
    to: '2026-10-21',
    days: '3.000',
    requested: '2026-09-15',
    status: 'approved',
  },
  {
    who: 'yuki',
    type: PERSONAL,
    from: '2026-10-21',
    to: '2026-10-21',
    days: '1.000',
    requested: '2026-09-22',
    status: 'approved',
  },
  {
    who: 'leo',
    type: VACATION,
    from: '2026-10-26',
    to: '2026-10-30',
    days: '5.000',
    requested: '2026-09-01',
    status: 'approved',
  },
  {
    who: 'hana',
    type: SICK,
    from: '2026-10-01',
    to: '2026-10-02',
    days: '2.000',
    requested: '2026-10-01',
    status: 'approved',
  },
  // ponytail: an hour-unit request books its working days as hours (the
  // application has no day-to-hours rule yet), so Ravi's day costs 1h here.
  {
    who: 'ravi',
    type: COMP,
    from: '2026-10-09',
    to: '2026-10-09',
    days: '1.000',
    requested: '2026-09-25',
    status: 'approved',
  },
];

/** Adam's week of 28 September (T20), Madrid time; no clock-out on Wednesday. */
const punches: readonly (readonly [
  string,
  string,
  'in' | 'out' | 'break_start' | 'break_end',
  'badge' | 'web',
])[] = [
  ['2026-09-28', '08:58', 'in', 'badge'],
  ['2026-09-28', '13:05', 'break_start', 'web'],
  ['2026-09-28', '13:50', 'break_end', 'web'],
  ['2026-09-28', '17:41', 'out', 'web'],
  ['2026-09-29', '09:02', 'in', 'badge'],
  ['2026-09-29', '13:30', 'break_start', 'web'],
  ['2026-09-29', '14:10', 'break_end', 'web'],
  ['2026-09-29', '18:47', 'out', 'web'],
  ['2026-09-30', '08:47', 'in', 'badge'],
  ['2026-09-30', '13:12', 'break_start', 'web'],
  ['2026-09-30', '14:02', 'break_end', 'web'],
  // Thursday, still working at 12:33.
  ['2026-10-01', '08:52', 'in', 'badge'],
];

export interface Seeded {
  readonly members: number;
  readonly requests: number;
}

/** Seed Acme's Platform team into `tenantId`. `null` when it was already there. */
export async function seedAcme(
  uow: UnitOfWork,
  tenantId: TenantId,
  newId: () => string,
): Promise<Result<Seeded | null>> {
  const at = (iso: string): EventContext => ({
    clock: fixedClock(iso),
    newId,
    actor: { kind: 'system', process: 'timeoff-seed' },
    correlationId: newId(),
    causationId: null,
    timeZone: 'Europe/Madrid',
  });
  const now = at(SEEDED_AT);
  const day = (d: string, hh = '09:00'): EventContext => at(`${d}T${hh}:00+02:00`);

  return transact({ uow }, tenantId, async (tx) => {
    if ((await tx.members.get(team.adam)) !== null) return ok(null);

    await settings(tx, tenantId, now);

    for (const [k, displayName, hireDate] of roster) {
      const fields = MemberFields.parse({
        personId: team[k],
        displayName,
        firstName: displayName.split(' ')[0],
        managerPersonId: k === 'marco' ? null : team.marco,
        teamKey: PLATFORM,
        teamName: 'Platform',
        locationKey: MADRID,
        country: 'ES',
        region: 'Comunidad de Madrid',
        city: 'Madrid',
        timeZone: 'Europe/Madrid',
        hireDate,
      });
      // oxlint-disable-next-line no-await-in-loop -- seven members, in order
      const hired = await upsertIn(tx, { clock: now.clock, newId }, fields, {
        eventId: null,
        effectiveFrom: null,
        correlationId: now.correlationId,
      });
      if (!hired.ok) return hired;
      // oxlint-disable-next-line no-await-in-loop -- seven members
      await tx.attendance.setSchedule(team[k], officeHours);
    }

    // What Adam carried in from 2025, and the overtime he banked in September.
    const yearStart = day('2026-01-01', '00:30');
    const carried = entry(
      {
        personId: team.adam,
        leaveTypeKey: VACATION,
        unit: 'day',
        kind: 'carry_over',
        amount: '4.167',
        effectiveOn: CalendarDate.parse('2026-01-01'),
        policyVersion: 1,
      },
      yearStart,
    );
    const banked = entry(
      {
        personId: team.adam,
        leaveTypeKey: COMP,
        unit: 'hour',
        kind: 'comp_earned',
        amount: '6.000',
        effectiveOn: CalendarDate.parse('2026-09-29'),
      },
      day('2026-09-30'),
    );
    const balances = await post(tx, [carried, banked]);
    if (!balances.ok) return balances;
    await tx.outbox.publish(adjustedEvents(yearStart, tenantId, [carried]));

    for (const r of requests) {
      // oxlint-disable-next-line no-await-in-loop -- in the order they happened
      const done = await request(tx, tenantId, r, day, newId);
      if (!done.ok) return done;
    }

    for (const [d, hhmm, kind, source] of punches) {
      const when = Instant.parse(`${d}T${hhmm}:00+02:00`);
      // oxlint-disable-next-line no-await-in-loop -- in the order punched
      await tx.attendance.appendPunch(team.adam, {
        id: newId(),
        at: when,
        recordedAt: when,
        kind,
        source,
        workModel: 'office',
        deviceId: null,
        insideOfficeArea: null,
        supersedes: null,
        reason: null,
      });
    }
    return ok({ members: roster.length, requests: requests.length });
  });
}

/** Leave types, policies, approval, holidays and the team minimum. */
async function settings(tx: Tx, tenantId: TenantId, ctx: EventContext): Promise<void> {
  for (const def of [...es.leaveTypes, ...ownTypes]) {
    const type = LeaveType.define(def);
    if (!type.ok) throw new Error(type.error.message);
    // oxlint-disable-next-line no-await-in-loop -- a dozen types
    await tx.leaveTypes.save(type.value);
  }
  for (const [n, definition] of [vacationPolicy, personalPolicy].entries()) {
    const policy = Policy.draft({
      id: policyId(`7ac0e000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`),
      tenantId,
      definition,
    });
    const published = policy.publish(CalendarDate.parse('2026-01-01'), ctx);
    if (!published.ok) throw new Error(published.error.message);
    // oxlint-disable-next-line no-await-in-loop -- two policies
    await tx.policies.save(policy);
    // oxlint-disable-next-line no-await-in-loop -- two policies
    await tx.outbox.publish(policy.drainEvents());
  }
  await tx.approvals.setRules([
    { subject: 'request', leaveTypes: null, when: 'always', approvers: ['manager'] },
    { subject: 'request', leaveTypes: null, when: 'below_zero', approvers: ['manager', 'hr'] },
  ]);
  await tx.approvals.setTeamMinimum(PLATFORM, { atLeast: 5, unit: 'people' });
  for (const layer of es.calendars.madrid) {
    // oxlint-disable-next-line no-await-in-loop -- three layers
    await tx.holidays.saveLayer(layer);
  }
  await tx.holidays.assign(
    MADRID,
    es.calendars.madrid.map((l) => l.key),
  );
}

/** One request, through the aggregate's transitions at the dates they happened. */
async function request(
  tx: Tx,
  tenantId: TenantId,
  r: Past,
  day: (d: string, hh?: string) => EventContext,
  newId: () => string,
): Promise<Result<void>> {
  const type = await tx.leaveTypes.get(r.type);
  if (type === null) throw new Error(`No leave type ${r.type}`);
  const asked = day(r.requested);
  const sent = LeaveRequest.request(
    {
      id: leaveRequestId(newId()),
      tenantId,
      personId: team[r.who],
      leaveType: type.definition,
      span: {
        from: CalendarDate.parse(r.from),
        to: CalendarDate.parse(r.to),
        startsHalfDay: r.half === true,
        endsHalfDay: false,
        workingDays: DayAmount.parse(r.days),
      },
      verdict: { kind: 'fits' },
    },
    asked,
  );
  if (!sent.ok) return sent;
  const { request: leave } = sent.value;
  const entries = [...sent.value.entries];
  const approver = r.who === 'marco' ? null : team.marco;
  const approved = leave.approve(
    { by: approver ?? newId(), jurisdiction: 'ES' },
    day(r.requested, '16:00'),
  );
  if (!approved.ok) return approved;
  if (r.status === 'taken') {
    const taken = leave.markTaken(day(addDays(CalendarDate.parse(r.to), 1), '03:00'));
    if (!taken.ok) return taken;
    entries.push(...taken.value);
  }
  return persist(
    tx,
    {
      request: leave,
      routing: {
        chain: ['manager'],
        step: 1,
        since: CalendarDate.parse(r.requested),
        escalatedTo: null,
      },
      note: null,
      requestedAt: asked.clock.instant(),
      proposedBy: null,
    },
    entries,
  );
}

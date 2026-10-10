import { ok, type Result } from '@kithena/domain-kit';
import {
  CalendarDate,
  type LeaveTypeKey,
  type PersonId,
  type PolicyDefinition,
} from '@kithena/contracts';

import { bridgesFor, writeBridges, yearAhead, type BridgeFacts } from '../assist/bridges.js';
import type { Writer } from '../assist/ports.js';
import { mayDecide } from '../approval/decide.js';
import { DEFAULT_SCHEDULE } from '../attendance/attendance.js';
import { calendarIn } from '../calendar/calendar.js';
import { AttendanceClock, standing } from '../../domain/attendance/clock.js';
import { dayOf } from '../../domain/attendance/day.js';
import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { addDays, daysBetween } from '../../domain/days.js';
import type { LeaveType } from '../../domain/policy/leave-type.js';
import type { LeaveRequest } from '../../domain/request/leave-request.js';
import type { Caller, Deps, Member, RequestRecord, Tx } from '../ports.js';
import { assess, LIVE, type Assessment } from '../request/assess.js';
import {
  applies,
  balanceFor,
  forbidden,
  isHrAdmin,
  leaveYear,
  notFound,
  policyFor,
  refuse,
  relates,
  self,
  selfOrHr,
  transact,
} from '../shared.js';
import type {
  BalanceLedgerView,
  BalanceView,
  BridgeView,
  HolidaysView,
  MemberView,
  MyRequestsView,
  OverviewView,
  PreviewView,
  RequestDetailView,
  RequestItem,
  RequestPanelView,
} from './views.js';

/**
 * The employee's screens (PRD §15.2): the overview (T1), the request panel
 * (T3, T5), my requests (T6) and one of them, where the days went (MT20)
 * and the holidays (MT21). One read each, answered whole, so a screen
 * renders from one query (§15.2's "one query per screen").
 *
 * Who may see what is decided here, never in a transport: a request's type
 * reaches its member, their approvers and HR; a teammate's comes through the
 * calendar's own visibility (`calendarIn`).
 */

type ReadDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'writer'>;

/* ---------------------------------------------------------------- shapes -- */

export const memberView = (m: Member): MemberView => ({
  personId: m.personId,
  displayName: m.displayName,
  firstName: m.firstName,
  teamKey: m.teamKey,
  teamName: m.teamName,
  locationKey: m.locationKey,
  timeZone: m.timeZone,
  managerPersonId: m.managerPersonId,
});

const WAITING: readonly LeaveRequest['status'][] = ['pending', 'change_pending'];

export function requestItem(
  record: RequestRecord,
  member: Pick<Member, 'displayName'>,
  types: ReadonlyMap<string, LeaveType>,
): RequestItem {
  const { request, routing } = record;
  const span = request.span;
  return {
    requestId: request.id,
    personId: request.personId,
    displayName: member.displayName,
    leaveTypeKey: request.leaveType.key,
    leaveTypeName:
      types.get(request.leaveType.key)?.definition.name.default ?? request.leaveType.key,
    category: request.leaveType.category,
    status: request.status,
    span: {
      from: span.from,
      to: span.to,
      startsHalfDay: span.startsHalfDay,
      endsHalfDay: span.endsHalfDay,
    },
    spans: request.spans.map((r) => ({ from: r.from, to: r.to })),
    workingDays: span.workingDays,
    requestedAt: record.requestedAt,
    waitingOn: WAITING.includes(request.status) ? (routing.chain[routing.step] ?? null) : null,
  };
}

export const typesOf = async (tx: Tx): Promise<Map<string, LeaveType>> =>
  new Map((await tx.leaveTypes.list()).map((t) => [t.definition.key, t]));

/** The policy's yearly grant for the member's tenure on a date: "of 25". */
function yearly(definition: PolicyDefinition, member: Member, on: CalendarDate): string | null {
  const years = Math.floor(daysBetween(member.hireDate, on) / 365.25);
  return definition.allowance.findLast((band) => band.fromYears <= years)?.days ?? null;
}

export async function balanceView(
  tx: Tx,
  member: Member,
  leaveType: LeaveType,
  on: CalendarDate,
): Promise<BalanceView> {
  const def = leaveType.definition;
  const balance = await balanceFor(tx, member, def.key, on);
  const policy = await policyFor(tx, member, def.key, on);
  return {
    leaveTypeKey: def.key,
    name: def.name.default,
    unit: def.unit,
    colorToken: def.colorToken,
    icon: def.icon,
    ...balance,
    yearly:
      policy === null ? null : (yearly(policy.definition, member, on) as BalanceView['yearly']),
  };
}

/** Every tracked type the member has a balance in. */
async function balancesIn(tx: Tx, member: Member, on: CalendarDate): Promise<BalanceView[]> {
  const out: BalanceView[] = [];
  for (const t of await tx.leaveTypes.list()) {
    if (!t.definition.tracked || t.deleted || !applies(t.definition.appliesTo, member)) continue;
    out.push(await balanceView(tx, member, t, on));
  }
  return out;
}

/** Whether the caller decides for, or covers, the member. */
export async function approves(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  personId: PersonId,
): Promise<boolean> {
  const [approver, delegate] = await Promise.all([
    relates(deps, caller, 'approver', personId),
    relates(deps, caller, 'delegate', personId),
  ]);
  return approver || delegate;
}

/**
 * Whose balances the caller may see: their own, the people they approve or
 * cover, and everyone's for HR. The People Graph's rule and the assistant's.
 */
export async function seesBalances(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  personId: PersonId,
  hr: boolean,
): Promise<boolean> {
  return hr || caller.personId === personId || approves(deps, caller, personId);
}

/* --------------------------------------------------------------- screens -- */

type Unwritten<V> = Omit<V, 'bridges'> & { readonly bridges: readonly BridgeFacts[] };

/** A read with bridge days, and their lines written once its transaction has closed. */
async function withBridges<V extends { readonly bridges: readonly BridgeView[] }>(
  writer: Writer | undefined,
  tenantId: Caller['tenantId'],
  read: Result<Unwritten<V>>,
): Promise<Result<V>> {
  if (!read.ok) return read;
  return ok({
    ...read.value,
    bridges: await writeBridges(writer, tenantId, read.value.bridges),
  } as unknown as V);
}

/** T1: the clock, the balances, what is coming up, who is off today and the best bridge days. */
export const overview =
  (deps: ReadDeps) =>
  async (caller: Caller): Promise<Result<OverviewView>> =>
    withBridges<OverviewView>(
      deps.writer,
      caller.tenantId,
      await transact<Unwritten<OverviewView>>(deps, caller.tenantId, async (tx) => {
        const me = caller.personId === null ? null : await tx.members.get(caller.personId);
        if (me === null) {
          return ok({
            member: null,
            clock: null,
            balances: [],
            comingUp: [],
            teamToday: [],
            bridges: [],
          });
        }
        const today = deps.clock.date(me.timeZone);
        const clock = AttendanceClock.of({
          tenantId: caller.tenantId,
          personId: me.personId,
          timeZone: me.timeZone,
          punches: await tx.attendance.punches(me.personId),
        });
        const day = dayOf({
          date: today,
          schedule: (await tx.attendance.schedule(me.personId)) ?? DEFAULT_SCHEDULE,
          shifts: clock.shifts,
          now: deps.clock.instant(),
          timeZone: me.timeZone,
          rules: await tx.attendance.rules(),
        });
        const types = await typesOf(tx);
        const comingUp = (
          await tx.requests.list({ personIds: [me.personId], statuses: LIVE, from: today })
        )
          .toSorted((a, b) => a.request.span.from.localeCompare(b.request.span.from))
          .slice(0, 5)
          .map((r) => requestItem(r, me, types));

        const team = await calendarIn(tx, deps, caller, { scope: 'team', from: today, to: today });
        const names = new Map(
          team.ok ? team.value.people.map((p) => [p.personId, p.displayName]) : [],
        );
        const teamToday = (team.ok ? team.value.entries : [])
          .filter((e) => e.personId !== me.personId)
          .map((e) => ({
            personId: e.personId,
            displayName: names.get(e.personId) ?? '',
            leaveTypeKey: e.shows === 'type' ? e.leaveTypeKey : null,
            span: e.span,
          }));

        return ok({
          member: memberView(me),
          clock: {
            state: clock.state,
            workModel: standing(clock.punches).at(-1)?.workModel ?? null,
            today: day,
          },
          balances: await balancesIn(tx, me, today),
          comingUp,
          teamToday,
          bridges: (await bridgesFor(tx, me, yearAhead(today))).slice(0, 2),
        });
      }),
    );

/** The panel's consequences, flattened for a screen to read. */
export async function previewView(tx: Tx, a: Assessment): Promise<PreviewView> {
  const { verdict, alternatives } = a.negative;
  const approver = a.approver === null ? null : await tx.members.get(a.approver);
  return {
    span: a.span,
    daysAway: a.daysAway,
    balance: a.balance,
    belowMinimum: a.belowMinimum,
    blocked: a.blocked,
    negative: {
      kind: verdict.kind,
      days: verdict.kind === 'borrow' ? verdict.days : null,
      nextYearStartsAt: verdict.kind === 'borrow' ? verdict.nextYearStartsAt : null,
      limit: verdict.kind === 'refused' ? verdict.limit : null,
      approvers: verdict.kind === 'borrow' ? [...verdict.approvers] : [],
      unpaid: alternatives.unpaid,
      shorten: alternatives.shorten,
    },
    approvers: [...a.approvers],
    approver:
      approver === null ? null : { personId: approver.personId, displayName: approver.displayName },
  };
}

export interface PanelQuery {
  readonly leaveTypeKey?: LeaveTypeKey | undefined;
  readonly from?: CalendarDate | undefined;
  readonly to?: CalendarDate | undefined;
  readonly startsHalfDay?: boolean | undefined;
  readonly endsHalfDay?: boolean | undefined;
}

/** T3, T5: the types the member may ask for and, once dates are chosen, what it would mean. */
export const requestPanel =
  (deps: ReadDeps) =>
  (caller: Caller, query: PanelQuery): Promise<Result<RequestPanelView>> =>
    transact<RequestPanelView>(deps, caller.tenantId, async (tx) => {
      const found = await self(tx, caller);
      if (!found.ok) return found;
      const me = found.value;
      const today = deps.clock.date(me.timeZone);
      const leaveTypes: RequestPanelView['leaveTypes'][number][] = [];
      for (const t of await tx.leaveTypes.list()) {
        const def = t.definition;
        if (t.deleted || t.hidden || !applies(def.appliesTo, me)) continue;
        leaveTypes.push({
          key: def.key,
          name: def.name.default,
          category: def.category,
          unit: def.unit,
          tracked: def.tracked,
          colorToken: def.colorToken,
          icon: def.icon,
          left: def.tracked ? (await balanceFor(tx, me, def.key, today)).left : null,
          requiresNoteAfterDays: def.requiresNote?.afterDays ?? null,
        });
      }
      const { leaveTypeKey, from, to } = query;
      if (leaveTypeKey === undefined || from === undefined || to === undefined) {
        return ok({ leaveTypes, preview: null });
      }
      if (to < from) return refuse('INVALID_PERIOD', 'Leave cannot end before it starts', ['to']);
      const assessed = await assess(tx, {
        member: me,
        leaveTypeKey,
        span: {
          from,
          to,
          startsHalfDay: query.startsHalfDay ?? false,
          endsHalfDay: query.endsHalfDay ?? false,
        },
        action: 'request',
        today,
      });
      if (!assessed.ok) return assessed;
      return ok({ leaveTypes, preview: await previewView(tx, assessed.value) });
    });

const CANCELLED: readonly LeaveRequest['status'][] = ['cancelled', 'withdrawn'];

/** T6: upcoming, past and cancelled, each in the order a person reads it. */
export const myRequests =
  (deps: ReadDeps) =>
  (
    caller: Caller,
    query: { readonly tab: MyRequestsView['tab'] },
  ): Promise<Result<MyRequestsView>> =>
    transact<MyRequestsView>(deps, caller.tenantId, async (tx) => {
      const found = await self(tx, caller);
      if (!found.ok) return found;
      const me = found.value;
      const today = deps.clock.date(me.timeZone);
      const types = await typesOf(tx);
      const mine = await tx.requests.list({ personIds: [me.personId] });
      const upcoming = (r: RequestRecord) =>
        LIVE.includes(r.request.status) && r.request.span.to >= today;
      const picked =
        query.tab === 'cancelled'
          ? mine
              .filter((r) => CANCELLED.includes(r.request.status))
              .toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt))
          : query.tab === 'upcoming'
            ? mine
                .filter(upcoming)
                .toSorted((a, b) => a.request.span.from.localeCompare(b.request.span.from))
            : mine
                .filter((r) => !upcoming(r) && !CANCELLED.includes(r.request.status))
                .toSorted((a, b) => b.request.span.from.localeCompare(a.request.span.from));
      return ok({ tab: query.tab, items: picked.map((r) => requestItem(r, me, types)) });
    });

/** T6 detail: one request, as its member, an approver or HR sees it. */
export const requestDetail =
  (deps: ReadDeps) =>
  (caller: Caller, query: { readonly requestId: string }): Promise<Result<RequestDetailView>> =>
    transact<RequestDetailView>(deps, caller.tenantId, async (tx) => {
      const record = await tx.requests.get(query.requestId as RequestRecord['request']['id']);
      if (record === null) return notFound('Request');
      const { request, routing } = record;
      const mine = caller.personId === request.personId;
      const hr = await isHrAdmin(deps, caller);
      if (!mine && !hr && !(await approves(deps, caller, request.personId))) return forbidden();
      const member = await tx.members.get(request.personId);
      if (member === null) return notFound('Member');
      const status = request.status;
      const pending = request.pendingChange;
      return ok({
        request: requestItem(record, member, await typesOf(tx)),
        note: record.note,
        notePresent: request.notePresent,
        // The sick note is health data: its member and HR, nobody else (§8.5).
        sickNoteFileId: mine || hr ? request.sickNoteFileId : null,
        pendingChange:
          pending === null
            ? null
            : {
                from: pending.from,
                to: pending.to,
                startsHalfDay: pending.startsHalfDay,
                endsHalfDay: pending.endsHalfDay,
              },
        proposals: request.proposals.map((p, index) => ({
          index,
          spans: p.spans.map((r) => ({ from: r.from, to: r.to })),
          workingDays: p.workingDays,
        })),
        proposalMessage: request.status === 'counter_proposed' ? record.proposalMessage : null,
        chain: [...routing.chain],
        step: routing.step,
        escalated: routing.escalatedTo !== null,
        mine,
        canChange: (mine || hr) && status === 'approved',
        canCancel:
          (mine || hr) &&
          ['pending', 'approved', 'counter_proposed', 'change_pending'].includes(status),
        canAnswer: mine && status === 'counter_proposed',
        canDecide: await mayDecide(deps, caller, record),
      });
    });

/** MT20: where the days of one type went this leave year, the member's own or HR's view. */
export const balanceLedger =
  (deps: ReadDeps) =>
  (
    caller: Caller,
    query: { readonly leaveTypeKey: LeaveTypeKey; readonly personId?: PersonId | undefined },
  ): Promise<Result<BalanceLedgerView>> =>
    transact<BalanceLedgerView>(deps, caller.tenantId, async (tx) => {
      if (query.personId === undefined) {
        const mine = await self(tx, caller);
        if (!mine.ok) return mine;
      }
      const personId = query.personId ?? caller.personId;
      if (personId === null) return forbidden();
      if (!(await selfOrHr(deps, caller, personId))) return forbidden();
      const member = await tx.members.get(personId);
      if (member === null) return notFound('Member');
      const leaveType = await tx.leaveTypes.get(query.leaveTypeKey);
      if (leaveType === null || !leaveType.definition.tracked) return notFound('Leave type');
      const today = deps.clock.date(member.timeZone);
      const policy = await policyFor(tx, member, query.leaveTypeKey, today);
      const { start, end } = leaveYear(policy?.definition ?? null, today);
      const entries = (await tx.ledger.forMember(personId, query.leaveTypeKey))
        .filter((e) => e.effectiveOn >= start && e.effectiveOn <= end)
        .toSorted(
          (a, b) =>
            a.effectiveOn.localeCompare(b.effectiveOn) || a.occurredAt.localeCompare(b.occurredAt),
        );
      return ok({ balance: await balanceView(tx, member, leaveType, today), entries });
    });

/**
 * MT21: the holidays the caller's work location observes in a year, and the
 * bridge days still ahead in it, in date order. Their lines are templates:
 * a list of every holiday is not worth a model call per visit.
 */
export const holidays =
  (deps: ReadDeps) =>
  async (caller: Caller, query: { readonly year: number }): Promise<Result<HolidaysView>> =>
    withBridges<HolidaysView>(
      undefined,
      caller.tenantId,
      await transact<Unwritten<HolidaysView>>(deps, caller.tenantId, async (tx) => {
        const me = caller.personId === null ? null : await tx.members.get(caller.personId);
        if (me?.locationKey == null) {
          return ok({ year: query.year, locationKey: null, holidays: [], bridges: [] });
        }
        const keys = await tx.holidays.assigned(me.locationKey);
        const layers = (await tx.holidays.layers())
          .filter((l) => keys.includes(l.key))
          .toSorted((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
        const today = deps.clock.date(me.timeZone);
        const first = CalendarDate.parse(`${String(query.year)}-01-01`);
        const last = CalendarDate.parse(`${String(query.year)}-12-31`);
        const from = addDays(today, 1) > first ? addDays(today, 1) : first;
        return ok({
          year: query.year,
          locationKey: me.locationKey,
          holidays: resolveHolidays(layers, query.year),
          bridges:
            from > last
              ? []
              : (await bridgesFor(tx, me, { from, to: last })).toSorted((a, b) =>
                  a.from.localeCompare(b.from),
                ),
        });
      }),
    );

/**
 * A person's balances on the People Graph (`Person.timeOffBalances`, §18):
 * the person themselves, their approvers and HR; anybody else gets `null`,
 * which says nothing about whether there is anything to see.
 */
export const personBalances =
  (deps: ReadDeps) =>
  (caller: Caller, personId: PersonId): Promise<Result<BalanceView[] | null>> =>
    transact<BalanceView[] | null>(deps, caller.tenantId, async (tx) => {
      if (!(await seesBalances(deps, caller, personId, await isHrAdmin(deps, caller)))) {
        return ok(null);
      }
      const member = await tx.members.get(personId);
      if (member === null) return ok(null);
      return ok(await balancesIn(tx, member, deps.clock.date(member.timeZone)));
    });

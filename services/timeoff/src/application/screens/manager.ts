import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, PersonId, TeamKey } from '@kithena/contracts';

import { approvalQueue, mayDecide, triageOf } from '../approval/decide.js';
import { DEFAULT_SCHEDULE, teamRightNow, timesheet } from '../attendance/attendance.js';
import { calendarIn, type CalendarQuery } from '../calendar/calendar.js';
import { AttendanceClock, standing, type Punch } from '../../domain/attendance/clock.js';
import { openDays } from '../../domain/attendance/correction.js';
import type { LookCloser, Triage } from '../../domain/approval/triage.js';
import { kithenaActivity, suggestFinish, type Evidence } from '../assist/clock-out.js';
import { writeDecision } from '../assist/decision.js';
import { writeToday } from '../assist/today.js';
import { reasonFacts, writeReasons, type ReasonFacts } from '../assist/reasons.js';
import { addDays, amount, days } from '../../domain/days.js';
import type { LeaveRequest, LeaveRequestId } from '../../domain/request/leave-request.js';
import type { Caller, Deps, Member, RequestRecord, Tx } from '../ports.js';
import { teamAlternatives, teamBelow } from '../request/assess.js';
import { balanceFor, forbidden, isHrAdmin, notFound, transact } from '../shared.js';
import { approves, memberView, requestItem, typesOf } from './employee.js';
import type {
  ApprovalsView,
  CalendarView,
  DecisionView,
  DelegationView,
  LookCloserReason,
  PunchView,
  RequestItem,
  RightNowView,
  TimesheetView,
  ViewerView,
  YearView,
  View,
} from './views.js';

/**
 * The approver's screens (PRD §9, §10.1, §15.2): the approvals tabs
 * (T16), deciding one (T17), delegation (T19), the calendar's views
 * (T12–T14), and what the shell asks about the viewer (TOF-058a).
 */

type ReadDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'writer' | 'judge' | 'calendar'>;

export const reasonView = (reason: LookCloser): View<typeof LookCloserReason> => ({
  rule: reason.rule,
  amount:
    reason.rule === 'below_zero'
      ? reason.by
      : reason.rule === 'over_banked'
        ? reason.short
        : reason.rule === 'sick_over_threshold'
          ? reason.days
          : null,
  days:
    reason.rule === 'below_minimum' || reason.rule === 'protected_period' ? [...reason.days] : [],
});

/** The caller's "today": their own zone, or UTC for an account that is not a member. */
async function todayOf(tx: Tx, deps: Pick<Deps, 'clock'>, caller: Caller): Promise<CalendarDate> {
  const me = caller.personId === null ? null : await tx.members.get(caller.personId);
  return deps.clock.date(me?.timeZone ?? 'UTC');
}

/** Records with their members, for the people the caller decides for (HR: everyone). */
async function decidedFor(
  tx: Tx,
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  records: readonly RequestRecord[],
): Promise<{ record: RequestRecord; member: Member }[]> {
  const hr = await isHrAdmin(deps, caller);
  const out: { record: RequestRecord; member: Member }[] = [];
  for (const record of records) {
    const { personId } = record.request;
    if (personId === caller.personId) continue;
    if (!hr && !(await approves(deps, caller, personId))) continue;
    const member = await tx.members.get(personId);
    if (member !== null) out.push({ record, member });
  }
  return out;
}

const DECIDED: readonly LeaveRequest['status'][] = ['approved', 'declined', 'taken', 'cancelled'];
const DECIDED_SHOWN = 50;

/** T16: waiting for me (clear and look closer), coming up, and decided. */
export const approvals =
  (deps: ReadDeps) =>
  async (
    caller: Caller,
    query: { readonly tab: ApprovalsView['tab'] },
  ): Promise<Result<ApprovalsView>> => {
    if (query.tab === 'waiting') {
      const queue = await approvalQueue(deps)(caller);
      if (!queue.ok) return queue;
      const read = await transact<{ view: Omit<ApprovalsView, 'why'>; facts: ReasonFacts[] }>(
        deps,
        caller.tenantId,
        async (tx) => {
          const types = await typesOf(tx);
          const facts: ReasonFacts[] = [];
          const item = async (
            requestId: LeaveRequestId,
            triage: Triage,
          ): Promise<RequestItem | null> => {
            const record = await tx.requests.get(requestId);
            const member = record === null ? null : await tx.members.get(record.request.personId);
            if (record === null || member === null) return null;
            const today = deps.clock.date(member.timeZone);
            facts.push(await reasonFacts(tx, record, member, triage, today));
            return requestItem(record, member, types);
          };
          const clear: RequestItem[] = [];
          for (const q of queue.value.clear) {
            const found = await item(q.requestId, { group: 'clear' });
            if (found !== null) clear.push(found);
          }
          const lookCloser: ApprovalsView['lookCloser'][number][] = [];
          for (const q of queue.value.lookCloser) {
            const found = await item(q.item.requestId, { group: 'look_closer', reason: q.reason });
            if (found !== null) lookCloser.push({ item: found, reason: reasonView(q.reason) });
          }
          return ok({ view: { tab: query.tab, clear, lookCloser, items: [] }, facts });
        },
      );
      if (!read.ok) return read;
      return ok({
        ...read.value.view,
        why: await writeReasons(deps.writer, caller.tenantId, read.value.facts),
      });
    }
    return transact<ApprovalsView>(deps, caller.tenantId, async (tx) => {
      const today = await todayOf(tx, deps, caller);
      const types = await typesOf(tx);
      const records =
        query.tab === 'coming_up'
          ? (await tx.requests.list({ statuses: ['approved'], from: today })).toSorted((a, b) =>
              a.request.span.from.localeCompare(b.request.span.from),
            )
          : (await tx.requests.list({ statuses: DECIDED })).toSorted((a, b) =>
              b.requestedAt.localeCompare(a.requestedAt),
            );
      const shown = (await decidedFor(tx, deps, caller, records))
        .slice(0, query.tab === 'decided' ? DECIDED_SHOWN : undefined)
        .map(({ record, member }) => requestItem(record, member, types));
      return ok({ tab: query.tab, clear: [], lookCloser: [], items: shown, why: [] });
    });
  };

/** T17: one request with what the approver weighs — the balance, the team, the rule. */
export const requestDecision =
  (deps: ReadDeps) =>
  async (
    caller: Caller,
    query: { readonly requestId: LeaveRequestId },
  ): Promise<Result<DecisionView>> => {
    const read = await transact<Omit<DecisionView, 'whatToKnow' | 'clash'>>(
      deps,
      caller.tenantId,
      async (tx) => {
        const record = await tx.requests.get(query.requestId);
        if (record === null) return notFound('Request');
        const { request } = record;
        const canDecide = await mayDecide(deps, caller, record);
        if (
          !canDecide &&
          !(await isHrAdmin(deps, caller)) &&
          !(await approves(deps, caller, request.personId))
        ) {
          return forbidden();
        }
        const member = await tx.members.get(request.personId);
        if (member === null) return notFound('Member');
        const span = request.pendingChange ?? request.span;
        const today = deps.clock.date(member.timeZone);
        let balance: DecisionView['balance'] = null;
        if (request.leaveType.tracked) {
          const before = (await balanceFor(tx, member, request.leaveType.key, today, request.id))
            .left;
          balance = { before, after: amount(days(before).minus(span.workingDays)) };
        }
        const below = await teamBelow(
          tx,
          member,
          span.from,
          span.to,
          [{ personId: member.personId, span, status: 'pending' }],
          request.id,
        );
        const verdict = await triageOf(tx, deps, record, member);
        const others = await calendarIn(tx, deps, caller, {
          scope: 'team',
          teamKey: member.teamKey,
          from: span.from,
          to: span.to,
        });
        const names = new Map(
          others.ok ? others.value.people.map((p) => [p.personId, p.displayName]) : [],
        );
        const waiting = request.status === 'pending' || request.status === 'change_pending';
        const options = waiting ? await teamAlternatives(tx, member, span, request.id) : [];
        const before = (
          await tx.requests.list({
            personIds: [member.personId],
            statuses: ['approved', 'taken'],
            to: addDays(span.from, -1),
          })
        )
          .map((r) => r.request.span)
          .filter((s) => s.to < span.from)
          .toSorted((a, b) => b.to.localeCompare(a.to))[0];
        return ok({
          request: requestItem(record, member, await typesOf(tx)),
          member: memberView(member),
          note: record.note,
          balance,
          belowMinimum: below,
          triage: {
            group: verdict.group,
            reason: verdict.group === 'look_closer' ? reasonView(verdict.reason) : null,
          },
          othersOff: (others.ok ? others.value.entries : [])
            .filter((e) => e.personId !== member.personId)
            .map((e) => ({
              personId: e.personId,
              displayName: names.get(e.personId) ?? '',
              leaveTypeKey: e.shows === 'type' ? e.leaveTypeKey : null,
              span: e.span,
            })),
          canDecide,
          lastTaken: before === undefined ? null : { from: before.from, to: before.to },
          alternatives: await Promise.all(
            options.map(async (o) => ({
              kind: o.kind,
              affects: o.affects,
              dates: [...o.dates],
              spans: o.spans.map((s) => ({ from: s.from, to: s.to })),
              coverage: [...o.coverage],
              swapped:
                o.kind === 'swap_days' ? { out: [...o.swapped.out], in: [...o.swapped.in] } : null,
              teammate:
                o.kind === 'ask_teammate'
                  ? {
                      personId: o.teammate,
                      displayName: (await tx.members.get(o.teammate))?.displayName ?? '',
                    }
                  : null,
              absence:
                o.kind === 'ask_teammate' ? { from: o.absence.from, to: o.absence.to } : null,
              message: null,
            })),
          ),
        });
      },
    );
    if (!read.ok) return read;
    const words = await writeDecision(deps.writer, caller.tenantId, read.value);
    return ok({
      ...read.value,
      alternatives: read.value.alternatives.map((a, i) => ({
        ...a,
        message: words.messages.get(i) ?? null,
      })),
      whatToKnow: words.whatToKnow,
      clash: words.clash,
    });
  };

/** T19: who covers for me, who I may choose, and whom I cover for. */
export const delegation =
  (deps: ReadDeps) =>
  (caller: Caller): Promise<Result<DelegationView>> =>
    transact<DelegationView>(deps, caller.tenantId, async (tx) => {
      if (caller.personId === null) return forbidden();
      const me = caller.personId;
      const everyone = (await tx.members.list()).filter((m) => m.status !== 'left');
      const name = (id: string) => everyone.find((m) => m.personId === id)?.displayName ?? '';
      const mine = await tx.approvals.delegation(me);
      // ponytail: one read per member; a by-delegate index when a tenant is large.
      const coveringFor: DelegationView['coveringFor'][number][] = [];
      for (const m of everyone) {
        const d = m.personId === me ? null : await tx.approvals.delegation(m.personId);
        if (d?.delegateId === me) {
          coveringFor.push({
            approverId: d.approverId,
            approverName: m.displayName,
            range: d.range,
            automatic: d.automatic,
          });
        }
      }
      const manager = everyone.find((m) => m.personId === me)?.managerPersonId ?? null;
      return ok({
        approverId: me,
        escalatesTo: manager === null ? null : { personId: manager, displayName: name(manager) },
        delegation:
          mine === null
            ? null
            : {
                delegateId: mine.delegateId,
                delegateName: name(mine.delegateId),
                range: mine.range,
                automatic: mine.automatic,
                salaryRelated: mine.salaryRelated,
              },
        candidates: everyone
          .filter((m) => m.personId !== me)
          .map((m) => ({ personId: m.personId, displayName: m.displayName })),
        coveringFor,
      });
    });

/** T12–T14: the calendar over a range, as the caller may see it. */
export const calendar =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (caller: Caller, query: CalendarQuery): Promise<Result<CalendarView>> =>
    transact<CalendarView>(deps, caller.tenantId, async (tx) => {
      const view = await calendarIn(tx, deps, caller, query);
      if (!view.ok) return view;
      return ok({
        from: query.from,
        to: query.to,
        people: [...view.value.people],
        entries: view.value.entries.map((e) => ({
          requestId: e.requestId,
          personId: e.personId,
          span: e.span,
          status: e.status,
          leaveTypeKey: e.shows === 'type' ? e.leaveTypeKey : null,
        })),
        holidays: [...view.value.holidays],
        coverage: [...view.value.coverage],
      });
    });

/** The year (T12's year view): how many people are off each day. */
export const calendarYear =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  async (
    caller: Caller,
    query: {
      readonly scope: CalendarQuery['scope'];
      readonly year: number;
      readonly teamKey?: TeamKey | null | undefined;
    },
  ): Promise<Result<YearView>> => {
    const view = await calendar(deps)(caller, {
      scope: query.scope,
      teamKey: query.teamKey ?? null,
      from: `${String(query.year)}-01-01` as CalendarDate,
      to: `${String(query.year)}-12-31` as CalendarDate,
    });
    if (!view.ok) return view;
    const off = new Map<CalendarDate, Set<string>>();
    for (const e of view.value.entries) {
      for (let day = e.span.from; day <= e.span.to; day = addDays(day, 1)) {
        off.set(day, (off.get(day) ?? new Set()).add(e.personId));
      }
    }
    return ok({
      year: query.year,
      days: [...off]
        .map(([date, who]) => ({ date, off: who.size }))
        .toSorted((a, b) => a.date.localeCompare(b.date)),
    });
  };

export const punchView = (p: Punch): PunchView => ({
  id: p.id,
  at: p.at,
  recordedAt: p.recordedAt,
  kind: p.kind,
  source: p.source,
  workModel: p.workModel,
  supersedes: p.supersedes,
  reason: p.reason,
});

/** T20: a timesheet by week or month — the caller's own unless another member is named. */
export const timesheetScreen =
  (deps: ReadDeps) =>
  async (
    caller: Caller,
    query: {
      readonly personId?: PersonId | undefined;
      readonly from: CalendarDate;
      readonly to: CalendarDate;
    },
  ): Promise<Result<TimesheetView>> => {
    const personId = query.personId ?? caller.personId;
    if (personId === null) return forbidden();
    const sheet = await timesheet(deps)(caller, { personId, from: query.from, to: query.to });
    if (!sheet.ok) return sheet;
    const mine = caller.personId === personId;
    const read = await transact<{ view: TimesheetView; activity: Evidence[][] }>(
      deps,
      caller.tenantId,
      async (tx) => {
        const member = await tx.members.get(personId);
        if (member === null) return notFound('Member');
        const activity = mine
          ? await Promise.all(
              sheet.value.open.map((o) => kithenaActivity(tx, personId, o.date, member.timeZone)),
            )
          : [];
        // A night shift's clock-out lands the morning after the range.
        const inRange = (at: string) =>
          at.slice(0, 10) >= query.from && at.slice(0, 10) <= addDays(query.to, 1);
        const s = sheet.value;
        return ok({
          activity,
          view: {
            member: memberView(member),
            days: [...s.days],
            weeks: s.weeks.map((w) => ({ ...w, flags: [...w.flags] })),
            open: s.open.map((o) => ({ ...o, suggestion: null })),
            restBreaches: [...s.restBreaches],
            overtime: s.overtime.map((o) => ({
              date: o.date,
              minutes: o.minutes,
              outcome: o.outcome,
            })),
            punches: standing(await tx.attendance.punches(personId))
              .filter((p) => inRange(p.at))
              .map(punchView),
            corrections: s.corrections.map((c) => ({
              punch: punchView(c.punch),
              needsManager: c.needsManager,
            })),
          },
        });
      },
    );
    if (!read.ok || !mine) return read.ok ? ok(read.value.view) : read;
    const { view, activity } = read.value;
    return ok({
      ...view,
      open: await Promise.all(
        view.open.map(async (o, i) => ({
          ...o,
          suggestion: await suggestFinish(
            deps,
            caller.tenantId,
            { personId, timeZone: view.member.timeZone },
            o,
            activity[i] ?? [],
          ),
        })),
      ),
    });
  };

/** T22: the caller's reports, live, and what needs them. */
export const rightNowScreen =
  (deps: ReadDeps) =>
  async (caller: Caller): Promise<Result<RightNowView>> => {
    const board = await teamRightNow(deps)(caller);
    if (!board.ok) return board;
    const names = new Map(board.value.people.map((p) => [p.personId, p.displayName]));
    const away = await transact<Set<string>>(deps, caller.tenantId, async (tx) => {
      const today = await todayOf(tx, deps, caller);
      const ids = board.value.people.map((p) => p.personId);
      const off =
        ids.length === 0
          ? []
          : await tx.requests.list({
              personIds: ids,
              statuses: ['approved', 'taken'],
              from: today,
              to: today,
            });
      return ok(new Set(off.map((r) => r.request.personId)));
    });
    if (!away.ok) return away;
    const view = {
      people: [...board.value.people],
      needsYou: board.value.needsYou.map((n) =>
        n.kind === 'correction'
          ? {
              kind: n.kind,
              personId: n.personId,
              displayName: names.get(n.personId) ?? '',
              punch: punchView(n.punch),
              date: n.punch.at.slice(0, 10) as CalendarDate,
              minutes: null,
            }
          : {
              kind: n.kind,
              personId: n.personId,
              displayName: names.get(n.personId) ?? '',
              punch: null,
              date: n.date,
              minutes: n.minutes,
            },
      ),
    };
    return ok({
      ...view,
      sentence: await writeToday(
        deps.writer,
        caller.tenantId,
        view.people,
        view.needsYou,
        away.value,
      ),
    });
  };

const EXCEPTIONS_DAYS = 31;

/**
 * TOF-058a: whether the caller approves anyone, whether they are HR, and the
 * counts on Requests and Attendance — requests waiting on them, and their
 * own missed clock-outs plus, for an approver, what needs them on the team.
 *
 * ponytail: "approves anyone" asks once per member; a `ListObjects` on the
 * approver relation is the upgrade when a tenant is large.
 */
export const viewer =
  (deps: ReadDeps) =>
  async (caller: Caller): Promise<Result<ViewerView>> => {
    const facts = await transact(deps, caller.tenantId, async (tx) => {
      const hrAdmin = await isHrAdmin(deps, caller);
      let approvesAnyone = false;
      for (const m of await tx.members.list()) {
        if (m.status === 'left' || m.personId === caller.personId) continue;
        if (await approves(deps, caller, m.personId)) {
          approvesAnyone = true;
          break;
        }
      }
      const me = caller.personId === null ? null : await tx.members.get(caller.personId);
      let missed = 0;
      if (me !== null) {
        const clock = AttendanceClock.of({
          tenantId: caller.tenantId,
          personId: me.personId,
          timeZone: me.timeZone,
          punches: await tx.attendance.punches(me.personId),
        });
        const since = addDays(deps.clock.date(me.timeZone), -EXCEPTIONS_DAYS);
        missed = openDays({
          shifts: clock.shifts,
          schedule: (await tx.attendance.schedule(me.personId)) ?? DEFAULT_SCHEDULE,
          now: deps.clock.instant(),
          timeZone: me.timeZone,
        }).filter((o) => o.date >= since).length;
      }
      return ok({ hrAdmin, approvesAnyone, missed });
    });
    if (!facts.ok) return facts;
    const { hrAdmin, approvesAnyone, missed } = facts.value;
    let requestsWaiting = 0;
    let needsYou = 0;
    if (approvesAnyone || hrAdmin) {
      const queue = await approvalQueue(deps)(caller);
      if (queue.ok) requestsWaiting = queue.value.clear.length + queue.value.lookCloser.length;
    }
    if (approvesAnyone) {
      const board = await teamRightNow(deps)(caller);
      if (board.ok) needsYou = board.value.needsYou.length;
    }
    return ok({
      approves: approvesAnyone,
      hrAdmin,
      counts: { requestsWaiting, attendanceExceptions: missed + needsYou },
    });
  };

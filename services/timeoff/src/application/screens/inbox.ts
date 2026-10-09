import { ok, type Result } from '@kithena/domain-kit';
import type {
  CalendarDate,
  InboxItem,
  InboxStep,
  LeaveTypeKey,
  Instant,
  PersonId,
  TimeOffApprovalDetail,
  TimeOffDecidedDetail,
  TimeOffExpiringDetail,
  TimeOffHolidaysDetail,
  TimeOffRequestDetail,
} from '@kithena/contracts';

import { escalation } from '../../domain/approval/delegation.js';
import { addDays, amount, days } from '../../domain/days.js';
import type { LeaveRequest } from '../../domain/request/leave-request.js';
import { approvalQueue } from '../approval/decide.js';
import { NUDGE_AFTER_MS } from '../request/request.js';
import {
  DEFAULT_ESCALATION,
  type Caller,
  type Deps,
  type Member,
  type RequestDecision,
  type RequestRecord,
  type Tx,
} from '../ports.js';
import { balanceFor, leaveYear, policyFor, transact } from '../shared.js';

/**
 * Time Off in the Inbox (Inbox design A2, rows "Time off"): what it has for
 * the person asking, in the shape every module answers with
 * (`@kithena/contracts`'s `InboxItem`), built from what Time Off keeps. No
 * row is copied anywhere: a request decided here is decided in the Inbox.
 *
 * - A request waiting on the caller is a **task** (G1): the dates, who else
 *   is out that week, the balance after, and Decide by from T34's rule.
 * - The caller's own request, waiting, is **their request** (E3): who has it,
 *   since when, and the steps.
 * - Their request, decided, is an **update** for 30 days (D1, D4) and a
 *   receipt in **Done** after (F1); one they withdrew is Done at once.
 * - A request the caller decided is a receipt in their Done.
 * - Days that will not carry over, with the year end three months off or
 *   less, are a **task** due on the last day (C9).
 */

type InboxDeps = Pick<Deps, 'uow' | 'authz' | 'clock'>;

const WAITING: readonly LeaveRequest['status'][] = ['pending', 'change_pending'];
/** How long a decision stays an update before it is only a receipt in Done. */
const UPDATE_DAYS = 30;
/** How far back Done reaches. */
const DONE_DAYS = 365;
/** How long before a year end days about to be lost are a task. */
const EXPIRY_NOTICE_DAYS = 92;

const shortDate = (d: CalendarDate, withYear = false): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

/** "28–30 Dec", "30 Dec – 2 Jan", "24 Dec". */
export function spanLabel(from: CalendarDate, to: CalendarDate): string {
  if (from === to) return shortDate(from);
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${String(Number(from.slice(8)))}–${shortDate(to)}`;
  return `${shortDate(from)} – ${shortDate(to)}`;
}

const dayCount = (n: string): string => {
  const v = days(n);
  const text = v.isInteger() ? v.toFixed(0) : v.toString();
  return `${text} ${v.eq(1) ? 'day' : 'days'}`;
};

const workingDayCount = (n: string): string => {
  const v = days(n);
  const text = v.isInteger() ? v.toFixed(0) : v.toString();
  return `${text} working ${v.eq(1) ? 'day' : 'days'}`;
};

const isWeekday = (d: CalendarDate): boolean => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6;
};

const daysBetween = (a: string, b: string): number =>
  Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);

const person = (m: Member | undefined | null) =>
  m === undefined || m === null ? null : { name: m.displayName, personId: m.personId };

export const timeOffInbox =
  (deps: InboxDeps) =>
  async (caller: Caller): Promise<Result<{ items: InboxItem[] }>> => {
    // The approvals are their own read (who may decide is OpenFGA's), beside the rest.
    const [queue, read] = await Promise.all([
      approvalQueue(deps)(caller),
      transact(deps, caller.tenantId, async (tx) => ok(await gather(tx, deps, caller))),
    ]);
    if (!read.ok) return read;
    const { members, rule } = read.value;
    const byId = new Map(members.map((m) => [m.personId, m]));
    const items: InboxItem[] = [...read.value.items];

    if (queue.ok) {
      const waiting = [...queue.value.clear, ...queue.value.lookCloser.map((l) => l.item)];
      const approvals = await transact(deps, caller.tenantId, async (tx) =>
        ok(
          await Promise.all(
            waiting.map((q) => approvalItem(tx, deps, q.requestId, byId, rule.afterWorkingDays)),
          ),
        ),
      );
      if (approvals.ok) items.push(...approvals.value.flatMap((a) => (a === null ? [] : [a])));
    }
    return ok({ items: items.toSorted((a, b) => b.at.localeCompare(a.at)) });
  };

/** Everything but the approvals, in one transaction. */
async function gather(tx: Tx, deps: InboxDeps, caller: Caller) {
  const members = await tx.members.list();
  const byId = new Map(members.map((m) => [m.personId, m]));
  const byAccount = new Map(
    members.flatMap((m) => (m.accountId === null ? [] : [[m.accountId, m] as const])),
  );
  const rule = (await tx.settings.get('escalation')) ?? DEFAULT_ESCALATION;
  const me = caller.personId === null ? null : (byId.get(caller.personId) ?? null);
  const items: InboxItem[] = [];
  if (me === null) return { members, me, rule, items };

  const today = deps.clock.date(me.timeZone);
  const now = deps.clock.instant();
  const types = new Map((await tx.leaveTypes.list()).map((t) => [t.definition.key, t]));
  const typeName = (key: string): string =>
    types.get(key as LeaveTypeKey)?.definition.name.default ?? key;

  // Their own requests: waiting, decided, withdrawn.
  const mine = await tx.requests.list({
    personIds: [me.personId],
    from: addDays(today, -DONE_DAYS),
  });
  const decisions = await tx.requests.decisions(mine.map((r) => r.request.id));
  const decisionsOf = (id: string) => decisions.filter((d) => d.requestId === id);

  for (const record of mine) {
    const { request, routing } = record;
    const id = request.id;
    const span = request.pendingChange ?? request.span;
    const label = spanLabel(span.from, span.to);
    const leaveTypeName = typeName(request.leaveType.key);
    const base = {
      module: 'timeoff',
      area: null,
      icon: 'calendar',
      tone: null,
      from: null,
      due: null,
      dueVerb: 'due' as const,
      count: null,
      team: null,
      replies: 0,
      link: `/time-off/requests/${id}`,
      openIn: 'Time off',
      message: null,
    };
    const balance = await balanceFor(tx, me, request.leaveType.key, today);
    const allowance = balance.allowance;

    if (WAITING.includes(request.status)) {
      const role = routing.chain[routing.step] ?? 'manager';
      const holderMember =
        routing.escalatedTo !== null && routing.escalatedTo !== 'hr'
          ? byId.get(routing.escalatedTo)
          : role === 'manager' && me.managerPersonId !== null
            ? byId.get(me.managerPersonId)
            : undefined;
      const holderName = holderMember?.displayName ?? 'HR';
      const holderFirst = holderMember?.firstName ?? 'HR';
      const waitingDays = Math.max(0, daysBetween(routing.since, today));
      const steps: InboxStep[] = [
        { label: 'Sent', state: 'done', note: formatWhen(record.requestedAt) },
        {
          label: `${holderFirst} decides`,
          state: 'current',
          note:
            waitingDays === 0
              ? 'Since today'
              : `${String(waitingDays)} ${waitingDays === 1 ? 'day' : 'days'} so far`,
        },
        { label: 'Approved', state: 'todo', note: 'Added to your calendar' },
      ];
      const detail: TimeOffRequestDetail = {
        requestId: id,
        leaveTypeName,
        from: span.from,
        to: span.to,
        workingDays: span.workingDays,
        steps,
        holder: { name: holderName, covering: null },
        since: record.requestedAt,
        balanceAfter: balance.left,
        allowance,
        instead: null,
        nudge: {
          from: new Date(Date.parse(record.requestedAt) + NUDGE_AFTER_MS).toISOString() as Instant,
          used: (record.nudgedAt ?? null) !== null,
        },
      };
      items.push({
        ...base,
        id: `timeoff:request:${id}`,
        lane: 'request',
        kind: 'timeoff.request',
        title: `Time off · ${label}`,
        summary: `${workingDayCount(span.workingDays)} · ${leaveTypeName}`,
        at: record.requestedAt,
        status: { label: `With ${holderFirst}`, tone: 'warning' },
        outcome: null,
        detail,
      });
      continue;
    }

    const steps = decisionsOf(id);
    const last = steps.at(-1);
    const approved = request.status === 'approved' || request.status === 'taken';
    const declined = request.status === 'declined';
    if (!approved && !declined) {
      // Withdrawn or cancelled: a receipt, nothing to tell.
      if (request.status === 'cancelled') {
        items.push({
          ...base,
          id: `timeoff:request:${id}`,
          lane: 'done',
          kind: 'timeoff.request',
          icon: 'calendar-x',
          title: `Time off · ${label}`,
          summary: 'You withdrew it',
          at: record.requestedAt,
          status: null,
          outcome: { label: 'Withdrawn', tone: 'neutral' },
          detail: null,
        });
      }
      continue;
    }
    const decidedAt = last?.decidedAt ?? record.requestedAt;
    const decider = last === undefined ? null : (byAccount.get(last.decidedBy) ?? null);
    const deciderFirst = decider?.firstName ?? 'HR';
    const followUp = declined
      ? (mine.find((r) => r.requestedAt > decidedAt && r.request.id !== id) ?? null)
      : null;
    const detail: TimeOffDecidedDetail = {
      requestId: id,
      leaveTypeName,
      from: span.from,
      to: span.to,
      workingDays: span.workingDays,
      approved,
      by: decider?.displayName ?? null,
      note: last?.reason ?? null,
      leftThisYear: balance.left,
      allowance,
      followUp:
        followUp === null
          ? null
          : {
              requestId: followUp.request.id,
              label: `You asked for ${spanLabel(followUp.request.span.from, followUp.request.span.to)} instead`,
              holder: null,
            },
    };
    const fresh = daysBetween(decidedAt, now) <= UPDATE_DAYS;
    if (fresh) {
      items.push({
        ...base,
        id: `timeoff:decided:${id}`,
        lane: 'update',
        kind: 'timeoff.decided',
        icon: approved ? 'calendar-check' : 'calendar-x',
        title: approved
          ? `${deciderFirst} approved your time off`
          : `${deciderFirst} declined your time off on ${label}`,
        summary: approved
          ? `${label} · ${dayCount(span.workingDays)} · ${dayCount(balance.left)} left this year`
          : last?.reason === null || last?.reason === undefined
            ? `${label} · ${dayCount(span.workingDays)}`
            : `“${last.reason}”`,
        from: person(decider),
        at: decidedAt,
        status: null,
        outcome: null,
        message: last?.reason ?? null,
        detail,
      });
    }
    items.push({
      ...base,
      id: `timeoff:request:${id}`,
      lane: 'done',
      kind: 'timeoff.request',
      icon: approved ? 'calendar-check' : 'calendar-x',
      title: `Time off · ${label}`,
      summary: `${approved ? 'Approved' : 'Declined'} by ${deciderFirst}`,
      at: decidedAt,
      status: null,
      outcome: approved
        ? { label: 'Approved', tone: 'success' }
        : { label: 'Declined', tone: 'danger' },
      detail,
    });
  }

  // What the caller decided for others: receipts in their Done.
  const decidedByMe = await decidedBy(tx, caller.accountId, addDays(today, -DONE_DAYS));
  for (const { record, decision } of decidedByMe) {
    const member = byId.get(record.request.personId);
    if (member === undefined || member.personId === me.personId) continue;
    const span = record.request.span;
    const approved = decision.outcome === 'approved' || decision.outcome === 'change_approved';
    items.push({
      id: `timeoff:decision:${decision.id}`,
      lane: 'done',
      kind: 'timeoff.approval',
      module: 'timeoff',
      area: null,
      icon: approved ? 'calendar-check' : 'calendar-x',
      tone: null,
      title: `${member.displayName} · ${spanLabel(span.from, span.to)}`,
      summary: `You ${approved ? 'approved' : 'declined'} it`,
      from: person(member),
      at: decision.decidedAt,
      due: null,
      dueVerb: 'decide',
      status: null,
      outcome: approved
        ? { label: 'Approved', tone: 'success' }
        : { label: 'Declined', tone: 'danger' },
      count: null,
      team: null,
      replies: 0,
      link: `/time-off/requests/${record.request.id}`,
      openIn: 'Time off',
      message: decision.reason,
      detail: null,
    });
  }

  // Next year's holidays where they work, once HR has saved them (D6).
  if (me.locationKey !== null) {
    const keys = await tx.holidays.assigned(me.locationKey);
    const layers = (await tx.holidays.layers()).filter((l) => keys.includes(l.key));
    const next = Number(today.slice(0, 4)) + 1;
    const ofYear = layers.flatMap((l) =>
      l.holidays.filter((h) => h.date.startsWith(String(next))).map((h) => ({ ...h, l })),
    );
    const savedAt = layers
      .filter((l) => l.holidays.some((h) => h.date.startsWith(String(next))))
      .map((l) => l.savedAt)
      .filter((at): at is string => at !== undefined)
      .toSorted()
      .at(-1);
    if (ofYear.length > 0 && savedAt !== undefined) {
      const dates = [...new Set(ofYear.map((h) => h.date))].toSorted();
      const first = ofYear.find((h) => h.date === dates[0]) ?? null;
      const place = [me.city, me.country].filter((x) => x !== null).join(' · ') || 'Where you work';
      const detail: TimeOffHolidaysDetail = {
        calendar: place,
        year: next,
        count: dates.length,
        first: first === null ? null : { date: first.date, name: first.name },
      };
      items.push({
        id: `timeoff:holidays:${me.locationKey}-${String(next)}`,
        lane: daysBetween(savedAt, now) <= UPDATE_DAYS ? 'update' : 'done',
        kind: 'timeoff.holidays',
        module: 'timeoff',
        area: null,
        icon: 'calendar',
        tone: null,
        title: `The ${String(next)} holiday calendar is out`,
        summary: `${place} · ${String(dates.length)} public holidays`,
        from: null,
        at: savedAt as Instant,
        due: null,
        dueVerb: 'due',
        status: null,
        outcome: null,
        count: null,
        team: null,
        replies: 0,
        link: `/time-off/holidays/${String(next)}`,
        openIn: 'Time off',
        message: null,
        detail,
      });
    }
  }

  // Days that will not carry over, as the year end comes (C9).
  for (const t of types.values()) {
    if (!t.definition.tracked || t.deleted || t.definition.category !== 'annual_leave') continue;
    const policy = await policyFor(tx, me, t.definition.key, today);
    if (policy === null) continue;
    const { end } = leaveYear(policy.definition, today);
    if (daysBetween(today, end) > EXPIRY_NOTICE_DAYS) continue;
    const balance = await balanceFor(tx, me, t.definition.key, today);
    const cap = days(policy.definition.carryOver?.maxDays ?? '0');
    const lose = days(balance.left).minus(cap);
    if (lose.lte(0)) continue;
    const detail: TimeOffExpiringDetail = {
      leaveTypeKey: t.definition.key,
      leaveTypeName: t.definition.name.default,
      days: amount(lose),
      by: end,
    };
    items.push({
      id: `timeoff:expiring:${t.definition.key}-${end}`,
      lane: 'task',
      kind: 'timeoff.expiring',
      module: 'timeoff',
      area: null,
      icon: 'calendar-clock',
      tone: null,
      title: `Use ${dayCount(amount(lose))} before ${shortDate(end)}`,
      summary: cap.isZero()
        ? 'They don’t carry over this year'
        : `Only ${dayCount(amount(cap))} carry over`,
      from: null,
      at: `${addDays(end, -EXPIRY_NOTICE_DAYS)}T00:00:00.000Z` as Instant,
      due: end,
      dueVerb: 'due',
      status: null,
      outcome: null,
      count: null,
      team: null,
      replies: 0,
      link: `/time-off/request`,
      openIn: 'Time off',
      message: null,
      detail,
    });
  }
  return { members, me, rule, items };
}

/** The requests an account decided since a day, with the decision. */
async function decidedBy(
  tx: Tx,
  accountId: string,
  since: CalendarDate,
): Promise<{ record: RequestRecord; decision: RequestDecision }[]> {
  const recent = await tx.requests.list({
    statuses: ['approved', 'declined', 'taken'],
    from: since,
  });
  const decisions = await tx.requests.decisions(recent.map((r) => r.request.id));
  const records = new Map(recent.map((r) => [r.request.id as string, r]));
  return decisions.flatMap((d) => {
    const record = records.get(d.requestId);
    return d.decidedBy === accountId && record !== undefined ? [{ record, decision: d }] : [];
  });
}

const formatWhen = (at: Instant): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(at));

/** G1: one request waiting on the caller, with what they need to decide. */
async function approvalItem(
  tx: Tx,
  deps: InboxDeps,
  requestId: string,
  byId: ReadonlyMap<PersonId, Member>,
  afterWorkingDays: number,
): Promise<InboxItem | null> {
  const record = await tx.requests.get(requestId as never);
  if (record === null) return null;
  const member = byId.get(record.request.personId);
  if (member === undefined) return null;
  const { request, routing } = record;
  const span = request.pendingChange ?? request.span;
  const today = deps.clock.date(member.timeZone);
  const types = await tx.leaveTypes.get(request.leaveType.key);
  const leaveTypeName = types?.definition.name.default ?? request.leaveType.key;

  // Who else on the team is out on each working day of the request (G1's strip).
  const team =
    member.teamKey === null
      ? []
      : [...byId.values()].filter(
          (m) =>
            m.teamKey === member.teamKey && m.status !== 'left' && m.personId !== member.personId,
        );
  const overlapping =
    team.length === 0
      ? []
      : await tx.requests.list({
          personIds: team.map((m) => m.personId),
          statuses: ['approved', 'taken', 'pending', 'change_pending'],
          from: span.from,
          to: span.to,
        });
  const week: TimeOffApprovalDetail['week'] = [];
  for (let d = span.from; d <= span.to && week.length < 10; d = addDays(d, 1)) {
    if (!isWeekday(d)) continue;
    const out = overlapping
      .filter((r) => r.request.span.from <= d && d <= r.request.span.to)
      .flatMap((r) => {
        const who = byId.get(r.request.personId);
        return who === undefined ? [] : [who.displayName];
      });
    week.push({ date: d, out });
  }
  const mostOut = Math.max(0, ...week.map((w) => w.out.length));
  const balance = await balanceFor(tx, member, request.leaveType.key, today, request.id);
  const after = days(balance.left).minus(span.workingDays);
  const earlier = (
    await tx.requests.list({
      personIds: [member.personId],
      statuses: ['declined'],
      from: addDays(today, -90),
    })
  ).at(-1);
  const due = escalation({
    pendingSince: routing.since,
    approverManagerId: null,
    isWorkingDay: isWeekday,
    afterWorkingDays,
  }).on;
  const detail: TimeOffApprovalDetail = {
    requestId: request.id,
    leaveTypeName,
    from: span.from,
    to: span.to,
    workingDays: span.workingDays,
    personName: member.displayName,
    teamName: member.teamName,
    week,
    alreadyOut: team.length === 0 ? null : { out: mostOut, of: team.length + 1 },
    balanceAfter: amount(after),
    allowance: balance.allowance,
    firstAsk:
      earlier === undefined
        ? null
        : `${spanLabel(earlier.request.span.from, earlier.request.span.to)}, which was declined`,
    note: record.note,
  };
  return {
    id: `timeoff:approval:${request.id}`,
    lane: 'task',
    kind: 'timeoff.approval',
    module: 'timeoff',
    area: null,
    icon: 'calendar',
    tone: null,
    title: `${member.displayName} · ${spanLabel(span.from, span.to)}`,
    summary: `${workingDayCount(span.workingDays)} · ${leaveTypeName}${request.status === 'change_pending' ? ' · a change' : ''}`,
    from: person(member),
    at: record.requestedAt,
    due,
    dueVerb: 'decide',
    status:
      (record.nudgedAt ?? null) !== null
        ? { label: `${member.firstName} nudged you`, tone: 'warning' }
        : routing.chain.length > 1
          ? {
              label: `Step ${String(routing.step + 1)} of ${String(routing.chain.length)}`,
              tone: 'neutral',
            }
          : null,
    outcome: null,
    count: null,
    team: null,
    replies: 0,
    link: `/time-off/approvals/waiting/${request.id}`,
    openIn: 'Time off',
    message: record.note,
    detail,
  };
}

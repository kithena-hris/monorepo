import { ok, type Result } from '@kithena/domain-kit';
import type {
  CalendarDate,
  InboxItem,
  InboxStep,
  LeaveTypeKey,
  LedgerEntry,
  Instant,
  PersonId,
  TimeOffApprovalDetail,
  TimeOffDecidedDetail,
  TimeOffExpiringDetail,
  TimeOffHolidaysDetail,
  TimeOffRequestDetail,
  TeamKey,
} from '@kithena/contracts';

import { escalation } from '../../domain/approval/delegation.js';
import { balanceOn, type Balance } from '../../domain/balance/ledger.js';
import type { WorkCalendar } from '../../domain/calendar/working-days.js';
import { coverage, type DayCoverage, type TeamMinimum } from '../../domain/coverage/coverage.js';
import { addDays, amount, days } from '../../domain/days.js';
import type { LeaveRequest, Span } from '../../domain/request/leave-request.js';
import { approvalQueue } from '../approval/decide.js';
import { LIVE } from '../request/assess.js';
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
import {
  balanceFor,
  calendarReader,
  leaveYear,
  policyFor,
  policyFrom,
  transact,
} from '../shared.js';
import { readerLocale, t } from '../reader-words.js';

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
const DECIDED: readonly LeaveRequest['status'][] = ['approved', 'declined', 'taken'];
/** How long a decision stays an update before it is only a receipt in Done. */
const UPDATE_DAYS = 30;
/** How far back Done reaches. */
const DONE_DAYS = 365;
/** How long before a year end days about to be lost are a task. */
const EXPIRY_NOTICE_DAYS = 92;

const shortDate = (d: CalendarDate, withYear = false): string =>
  new Intl.DateTimeFormat(readerLocale(), {
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
  return t(
    'inbox.inbox.day_count',
    { one: '{{text}} day', other: '{{text}} days' },
    {
      count: v.eq(1) ? 1 : 2,
      text,
    },
  );
};

const workingDayCount = (n: string): string => {
  const v = days(n);
  const text = v.isInteger() ? v.toFixed(0) : v.toString();
  return t(
    'inbox.inbox.working_day_count',
    { one: '{{text}} working day', other: '{{text}} working days' },
    { count: v.eq(1) ? 1 : 2, text },
  );
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
          await approvalItems(
            tx,
            deps,
            waiting.map((q) => q.requestId),
            byId,
            rule.afterWorkingDays,
          ),
        ),
      );
      if (approvals.ok) items.push(...approvals.value);
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
      icon: 'leave',
      tone: null,
      from: null,
      due: null,
      dueVerb: 'due' as const,
      count: null,
      team: null,
      replies: 0,
      link: `/time-off/requests/${id}`,
      openIn: t('inbox.inbox.time_off', 'Time off'),
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
      const holderName = holderMember?.displayName ?? t('inbox.inbox.hr', 'HR');
      const holderFirst = holderMember?.firstName ?? t('inbox.inbox.hr', 'HR');
      const waitingDays = Math.max(0, daysBetween(routing.since, today));
      const steps: InboxStep[] = [
        {
          label: t('inbox.inbox.sent', 'Sent'),
          state: 'done',
          note: formatWhen(record.requestedAt),
        },
        {
          label: `${holderFirst} decides`,
          state: 'current',
          note:
            waitingDays === 0
              ? t('inbox.inbox.since_today', 'Since today')
              : t(
                  'inbox.inbox.days_so_far',
                  { one: '{{count}} day so far', other: '{{count}} days so far' },
                  { count: waitingDays },
                ),
        },
        {
          label: t('inbox.inbox.approved', 'Approved'),
          state: 'todo',
          note: t('inbox.inbox.added_to_your_calendar', 'Added to your calendar'),
        },
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
        title: t('inbox.inbox.time_off_2', 'Time off · {{label}}', { label }),
        summary: `${workingDayCount(span.workingDays)} · ${leaveTypeName}`,
        at: record.requestedAt,
        status: {
          label: t('inbox.inbox.with', 'With {{holderFirst}}', { holderFirst }),
          tone: 'warning',
        },
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
          icon: 'reject',
          title: t('inbox.inbox.time_off_2', 'Time off · {{label}}', { label }),
          summary: t('inbox.inbox.you_withdrew_it', 'You withdrew it'),
          at: record.requestedAt,
          status: null,
          outcome: { label: t('inbox.inbox.withdrawn', 'Withdrawn'), tone: 'neutral' },
          detail: null,
        });
      }
      continue;
    }
    const decidedAt = last?.decidedAt ?? record.requestedAt;
    const decider = last === undefined ? null : (byAccount.get(last.decidedBy) ?? null);
    const deciderFirst = decider?.firstName ?? t('inbox.inbox.hr', 'HR');
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
              label: t('inbox.inbox.you_asked_for_instead', 'You asked for {{value}} instead', {
                value: spanLabel(followUp.request.span.from, followUp.request.span.to),
              }),
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
        icon: approved ? 'approve' : 'reject',
        title: approved
          ? t('inbox.inbox.approved_your_time_off', '{{deciderFirst}} approved your time off', {
              deciderFirst,
            })
          : t(
              'inbox.inbox.declined_your_time_off_on',
              '{{deciderFirst}} declined your time off on {{label}}',
              { deciderFirst, label },
            ),
        summary: approved
          ? t(
              'inbox.inbox.left_this_year',
              '{{label}} · {{workingDays}} · {{left}} left this year',
              { label, workingDays: dayCount(span.workingDays), left: dayCount(balance.left) },
            )
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
      icon: approved ? 'approve' : 'reject',
      title: t('inbox.inbox.time_off_2', 'Time off · {{label}}', { label }),
      summary: approved
        ? t('inbox.inbox.approved_by', 'Approved by {{deciderFirst}}', { deciderFirst })
        : t('inbox.inbox.declined_by', 'Declined by {{deciderFirst}}', { deciderFirst }),
      at: decidedAt,
      status: null,
      outcome: approved
        ? { label: t('inbox.inbox.approved', 'Approved'), tone: 'success' }
        : { label: t('inbox.inbox.declined', 'Declined'), tone: 'danger' },
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
      icon: approved ? 'approve' : 'reject',
      tone: null,
      title: `${member.displayName} · ${spanLabel(span.from, span.to)}`,
      summary: approved
        ? t('inbox.inbox.you_approved_it', 'You approved it')
        : t('inbox.inbox.you_declined_it', 'You declined it'),
      from: person(member),
      at: decision.decidedAt,
      due: null,
      dueVerb: 'decide',
      status: null,
      outcome: approved
        ? { label: t('inbox.inbox.approved', 'Approved'), tone: 'success' }
        : { label: t('inbox.inbox.declined', 'Declined'), tone: 'danger' },
      count: null,
      team: null,
      replies: 0,
      link: `/time-off/requests/${record.request.id}`,
      openIn: t('inbox.inbox.time_off', 'Time off'),
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
      const place =
        [me.city, me.country].filter((x) => x !== null).join(' · ') ||
        t('inbox.inbox.where_you_work', 'Where you work');
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
        icon: 'leave',
        tone: null,
        title: t(
          'inbox.inbox.the_holiday_calendar_is_out',
          'The {{next}} holiday calendar is out',
          { next: String(next) },
        ),
        summary: t(
          'inbox.inbox.public_holidays',
          {
            one: '{{place}} · {{count}} public holiday',
            other: '{{place}} · {{count}} public holidays',
          },
          { place, count: dates.length },
        ),
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
        openIn: t('inbox.inbox.time_off', 'Time off'),
        message: null,
        detail,
      });
    }
  }

  // Days that will not carry over, as the year end comes (C9).
  for (const type of types.values()) {
    if (!type.definition.tracked || type.deleted || type.definition.category !== 'annual_leave')
      continue;
    const policy = await policyFor(tx, me, type.definition.key, today);
    if (policy === null) continue;
    const { end } = leaveYear(policy.definition, today);
    if (daysBetween(today, end) > EXPIRY_NOTICE_DAYS) continue;
    const balance = await balanceFor(tx, me, type.definition.key, today);
    const cap = days(policy.definition.carryOver?.maxDays ?? '0');
    const lose = days(balance.left).minus(cap);
    if (lose.lte(0)) continue;
    const detail: TimeOffExpiringDetail = {
      leaveTypeKey: type.definition.key,
      leaveTypeName: type.definition.name.default,
      days: amount(lose),
      by: end,
    };
    items.push({
      id: `timeoff:expiring:${type.definition.key}-${end}`,
      lane: 'task',
      kind: 'timeoff.expiring',
      module: 'timeoff',
      area: null,
      icon: 'pending',
      tone: null,
      title: t('inbox.inbox.use_before', 'Use {{lose}} before {{end}}', {
        lose: dayCount(amount(lose)),
        end: shortDate(end),
      }),
      summary: cap.isZero()
        ? t('inbox.inbox.they_don_t_carry_over_this', 'They don’t carry over this year')
        : t('inbox.inbox.only_carry_over', 'Only {{cap}} carry over', {
            cap: dayCount(amount(cap)),
          }),
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
      openIn: t('inbox.inbox.time_off', 'Time off'),
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
  // Their own decisions first, then only those requests: read the other way
  // round, a company's year of requests was read to find a manager's few.
  const decisions = await tx.requests.decisionsBy(accountId);
  const records = new Map<string, RequestRecord | null>();
  for (const id of new Set(decisions.map((d) => d.requestId))) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, one request each
    records.set(id, await tx.requests.get(id));
  }
  return decisions.flatMap((d) => {
    const record = records.get(d.requestId);
    return record !== null &&
      record !== undefined &&
      DECIDED.includes(record.request.status) &&
      record.request.span.to >= since
      ? [{ record, decision: d }]
      : [];
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

/** The statuses G1's strip shows a teammate out for. */
const OUT: readonly LeaveRequest['status'][] = ['approved', 'taken', 'pending', 'change_pending'];

/**
 * G1 for every request waiting on the caller, read together: the requests,
 * the types, the requesters' ledgers and declines, and each team's minimum,
 * calendars and time off over the span its requests cover. Asked request by
 * request, a company's queue for HR was thousands of queries on every page.
 */
async function approvalItems(
  tx: Tx,
  deps: InboxDeps,
  requestIds: readonly string[],
  byId: ReadonlyMap<PersonId, Member>,
  afterWorkingDays: number,
): Promise<InboxItem[]> {
  const wanted = new Set(requestIds);
  if (wanted.size === 0) return [];
  const waiting = (await tx.requests.list({ statuses: WAITING })).filter((r) =>
    wanted.has(r.request.id),
  );
  const asked = waiting.flatMap((record) => {
    const member = byId.get(record.request.personId);
    if (member === undefined) return [];
    const span = record.request.pendingChange ?? record.request.span;
    return [{ record, member, span, today: deps.clock.date(member.timeZone) }];
  });
  if (asked.length === 0) return [];
  const requesters = [...new Set(asked.map((a) => a.member.personId))];
  const typeKeys = [...new Set(asked.map((a) => a.record.request.leaveType.key))];

  const [types, policies, ledgers, declined] = await Promise.all([
    tx.leaveTypes.list(),
    Promise.all(typeKeys.map((k) => tx.policies.forLeaveType(k))),
    Promise.all(typeKeys.map((k) => tx.ledger.forMembers(requesters, k))),
    tx.requests.list({
      personIds: requesters,
      statuses: ['declined'],
      from: addDays(asked.map((a) => a.today).toSorted()[0] as CalendarDate, -90),
    }),
  ]);
  const typeOf = new Map(types.map((type) => [type.definition.key, type]));
  const policiesOf = new Map(typeKeys.map((k, i) => [k, policies[i] ?? []]));
  const entriesOf = new Map(
    typeKeys.map((k, i) => {
      const byPerson = new Map<string, LedgerEntry[]>();
      for (const e of ledgers[i] ?? []) {
        const held = byPerson.get(e.personId) ?? [];
        held.push(e);
        byPerson.set(e.personId, held);
      }
      return [k, byPerson] as const;
    }),
  );
  const declinedOf = new Map<string, RequestRecord[]>();
  for (const r of declined) {
    const held = declinedOf.get(r.request.personId) ?? [];
    held.push(r);
    declinedOf.set(r.request.personId, held);
  }

  // Each team once: who is on it, its minimum, their calendars, and their
  // time off over every day the team's requests ask for.
  const calendar = calendarReader(tx);
  const teams = new Map<TeamKey, Promise<TeamRead>>();
  const teamOf = (teamKey: TeamKey): Promise<TeamRead> => {
    const held = teams.get(teamKey);
    if (held !== undefined) return held;
    const spans = asked.filter((a) => a.member.teamKey === teamKey).map((a) => a.span);
    const from = spans.map((x) => x.from).toSorted()[0] as CalendarDate;
    const to = spans
      .map((x) => x.to)
      .toSorted()
      .at(-1) as CalendarDate;
    const members = [...byId.values()].filter((m) => m.teamKey === teamKey && m.status !== 'left');
    const read = (async (): Promise<TeamRead> => {
      const [minimum, calendars, records] = await Promise.all([
        tx.approvals.teamMinimum(teamKey),
        Promise.all(
          members.map(async (m) => ({
            personId: m.personId,
            calendar: await calendar(m, from, to),
          })),
        ),
        tx.requests.list({
          personIds: members.map((m) => m.personId),
          statuses: [...new Set([...OUT, ...LIVE])],
          from,
          to,
        }),
      ]);
      return { members, minimum, calendars, records };
    })();
    teams.set(teamKey, read);
    return read;
  };

  return Promise.all(
    asked.map(async ({ record, member, span, today }) => {
      const { request } = record;
      const leaveTypeName =
        typeOf.get(request.leaveType.key)?.definition.name.default ?? request.leaveType.key;
      const team = member.teamKey === null ? null : await teamOf(member.teamKey);
      const others = (team?.members ?? []).filter((m) => m.personId !== member.personId);
      const overlapping = (team?.records ?? []).filter(
        (r) =>
          r.request.personId !== member.personId &&
          OUT.includes(r.request.status) &&
          r.request.span.from <= span.to &&
          span.from <= r.request.span.to,
      );
      const short =
        team === null || team.minimum === null
          ? []
          : coverage({
              members: team.calendars,
              absences: [
                ...team.records
                  .filter((r) => r.request.id !== request.id && LIVE.includes(r.request.status))
                  .flatMap((r) =>
                    r.request.spans.map((run) => ({
                      personId: r.request.personId,
                      span: {
                        from: run.from,
                        to: run.to,
                        startsHalfDay: false,
                        endsHalfDay: false,
                      },
                      status:
                        r.request.status === 'pending'
                          ? ('pending' as const)
                          : ('approved' as const),
                    })),
                  ),
                { personId: member.personId, span, status: 'pending' as const },
              ],
              minimum: team.minimum,
              from: span.from,
              to: span.to,
            }).days.filter((d) => d.below);
      const policy = policyFrom(policiesOf.get(request.leaveType.key) ?? [], member, today);
      const { start, end } = leaveYear(policy?.definition ?? null, today);
      const balance = balanceOn(
        (entriesOf.get(request.leaveType.key)?.get(member.personId) ?? []).filter(
          (e) => e.effectiveOn >= start && e.effectiveOn <= end && e.requestId !== request.id,
        ),
        today,
      );
      const earlier = (declinedOf.get(member.personId) ?? [])
        .filter((r) => r.request.span.to >= addDays(today, -90))
        .at(-1);
      return approvalItem(record, member, span, {
        leaveTypeName,
        others,
        overlapping,
        short,
        balance,
        earlier,
        byId,
        afterWorkingDays,
      });
    }),
  );
}

interface TeamRead {
  readonly members: readonly Member[];
  readonly minimum: TeamMinimum | null;
  readonly calendars: readonly { personId: PersonId; calendar: WorkCalendar }[];
  readonly records: readonly RequestRecord[];
}

/** G1: one request waiting on the caller, with what they need to decide, from what was read. */
function approvalItem(
  record: RequestRecord,
  member: Member,
  span: Span,
  read: {
    readonly leaveTypeName: string;
    readonly others: readonly Member[];
    readonly overlapping: readonly RequestRecord[];
    readonly short: readonly DayCoverage[];
    readonly balance: Balance;
    readonly earlier: RequestRecord | undefined;
    readonly byId: ReadonlyMap<PersonId, Member>;
    readonly afterWorkingDays: number;
  },
): InboxItem {
  const { request, routing } = record;
  const { leaveTypeName, overlapping, balance, earlier, byId, afterWorkingDays } = read;
  const team = read.others;
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
  const after = days(balance.left).minus(span.workingDays);
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
    short: read.short.map((d) => ({ date: d.date, in: d.in, of: d.of, required: d.required })),
    balanceAfter: amount(after),
    allowance: balance.allowance,
    firstAsk:
      earlier === undefined
        ? null
        : t('inbox.inbox.which_was_declined', '{{value}}, which was declined', {
            value: spanLabel(earlier.request.span.from, earlier.request.span.to),
          }),
    note: record.note,
  };
  return {
    id: `timeoff:approval:${request.id}`,
    lane: 'task',
    kind: 'timeoff.approval',
    module: 'timeoff',
    area: null,
    icon: 'leave',
    tone: null,
    title: `${member.displayName} · ${spanLabel(span.from, span.to)}`,
    summary: `${workingDayCount(span.workingDays)} · ${leaveTypeName}${request.status === 'change_pending' ? t('inbox.inbox.a_change', ' · a change') : ''}`,
    from: person(member),
    at: record.requestedAt,
    due,
    dueVerb: 'decide',
    status:
      (record.nudgedAt ?? null) !== null
        ? {
            label: t('inbox.inbox.nudged_you', '{{firstName}} nudged you', {
              firstName: member.firstName,
            }),
            tone: 'warning',
          }
        : routing.chain.length > 1
          ? {
              label: t('inbox.inbox.step_of', 'Step {{step}} of {{steps}}', {
                step: routing.step + 1,
                steps: routing.chain.length,
              }),
              tone: 'neutral',
            }
          : null,
    outcome: null,
    count: null,
    team: null,
    replies: 0,
    link: `/time-off/approvals/waiting/${request.id}`,
    openIn: t('inbox.inbox.time_off', 'Time off'),
    message: record.note,
    detail,
  };
}

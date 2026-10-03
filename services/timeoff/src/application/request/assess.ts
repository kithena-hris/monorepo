import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DateSpan, DayAmount, LeaveTypeKey, PersonId } from '@kithena/contracts';

import {
  resolveApprovers,
  type ApprovalCase,
  type ApproverRole,
} from '../../domain/approval/approval-rule.js';
import {
  goingBelowZero,
  type Alternatives,
  type NegativeVerdict,
} from '../../domain/balance/negative.js';
import {
  datesIn,
  daysAway,
  isWorkingDay,
  workingDays,
  type WorkCalendar,
} from '../../domain/calendar/working-days.js';
import { coverage, type Absence, type DayCoverage } from '../../domain/coverage/coverage.js';
import { amount, days } from '../../domain/days.js';
import type { LeaveType } from '../../domain/policy/leave-type.js';
import type { LeaveRequest, Span } from '../../domain/request/leave-request.js';
import type { Member, RequestRecord, Tx } from '../ports.js';
import { applies, balanceFor, calendarOf, notFound, policyFor, refuse } from '../shared.js';

/**
 * What a request would mean, worked out before anything is saved (PRD §8.2):
 * its cost in working days, the days away, the balance before and after, the
 * days the team would fall below its minimum, the verdict on going below
 * zero, and who would approve it. The request panel shows this as it is;
 * sending runs the same assessment and then acts on it.
 */

/** The statuses that keep someone out, for coverage and for overlap. */
export const LIVE: readonly LeaveRequest['status'][] = [
  'pending',
  'approved',
  'change_pending',
  'counter_proposed',
];

export interface Assessment {
  readonly member: Member;
  readonly leaveType: LeaveType;
  readonly span: Span;
  readonly daysAway: {
    readonly from: CalendarDate;
    readonly to: CalendarDate;
    readonly days: DayAmount;
  };
  /** `null` for an untracked type. */
  readonly balance: { readonly before: DayAmount; readonly after: DayAmount } | null;
  /** Only the days below the minimum: "Wed 21 Oct: only 4 of 7 on Platform would be in". */
  readonly belowMinimum: readonly DayCoverage[];
  /** Whether the policy blocks a request below the team minimum and this one is. */
  readonly blocked: boolean;
  readonly negative: { readonly verdict: NegativeVerdict; readonly alternatives: Alternatives };
  readonly approvers: readonly ApproverRole[];
  /** The person named on the button: "Send to Marco". `null` when it goes to HR or nobody. */
  readonly approver: PersonId | null;
  readonly calendar: WorkCalendar;
  readonly policyVersion: number | null;
}

/** Live time off overlapping a range, as coverage counts it. */
export async function absencesIn(
  tx: Tx,
  personIds: readonly PersonId[],
  from: CalendarDate,
  to: CalendarDate,
  excluding: string | null,
): Promise<Absence[]> {
  const records = await tx.requests.list({ personIds, statuses: LIVE, from, to });
  return records
    .filter((r) => r.request.id !== excluding)
    .flatMap(({ request }) =>
      request.spans.map((run) => ({
        personId: request.personId,
        span: { from: run.from, to: run.to, startsHalfDay: false, endsHalfDay: false },
        status: request.status === 'pending' ? ('pending' as const) : ('approved' as const),
      })),
    );
}

/** The team's coverage over a range, with one more absence, or `[]` with no minimum. */
export async function teamBelow(
  tx: Tx,
  member: Member,
  from: CalendarDate,
  to: CalendarDate,
  extra: readonly Absence[],
  excluding: string | null,
): Promise<DayCoverage[]> {
  if (member.teamKey === null) return [];
  const minimum = await tx.approvals.teamMinimum(member.teamKey);
  if (minimum === null) return [];
  const team = (await tx.members.list({ teamKey: member.teamKey })).filter(
    (m) => m.status !== 'left',
  );
  const members = await Promise.all(
    team.map(async (m) => ({ personId: m.personId, calendar: await calendarOf(tx, m, from, to) })),
  );
  const absences = [
    ...(await absencesIn(
      tx,
      team.map((m) => m.personId),
      from,
      to,
      excluding,
    )),
    ...extra,
  ];
  return coverage({ members, absences, minimum, from, to }).days.filter((day) => day.below);
}

export async function assess(
  tx: Tx,
  input: {
    readonly member: Member;
    readonly leaveTypeKey: LeaveTypeKey;
    readonly span: DateSpan;
    readonly action: ApprovalCase['action'];
    readonly today: CalendarDate;
    /** The request being changed, whose own booking and absence do not count against it. */
    readonly excluding?: RequestRecord | null;
  },
): Promise<Result<Assessment>> {
  const { member, span, today } = input;
  const excluding = input.excluding?.request.id ?? null;
  const leaveType = await tx.leaveTypes.get(input.leaveTypeKey);
  if (
    leaveType === null ||
    leaveType.deleted ||
    leaveType.hidden ||
    !applies(leaveType.definition.appliesTo, member)
  ) {
    return notFound('Leave type');
  }
  const def = leaveType.definition;
  const policy = def.tracked ? await policyFor(tx, member, def.key, span.from) : null;
  const halfDays = policy?.definition.requests.halfDays ?? true;
  if (!halfDays && (span.startsHalfDay || span.endsHalfDay)) {
    return refuse('NO_HALF_DAYS', 'This leave type is taken in whole days', ['span']);
  }

  const calendar = await calendarOf(tx, member, span.from, span.to);
  const cost = workingDays(span, calendar);
  if (days(cost).lte(0)) {
    return refuse('NO_WORKING_DAYS', 'These dates have no working days in them', ['span']);
  }
  const workingDates = datesIn(span.from, span.to).filter((d) => isWorkingDay(d, calendar));

  let balance: Assessment['balance'] = null;
  let negative: Assessment['negative'] = {
    verdict: { kind: 'fits' },
    alternatives: { unpaid: null, shorten: null },
  };
  if (def.tracked) {
    const now = await balanceFor(tx, member, def.key, today, excluding);
    balance = { before: now.left, after: amount(days(now.left).minus(cost)) };
    negative = goingBelowZero({
      rule: policy?.definition.negativeBalance ?? null,
      left: now.left,
      cost,
      nextYearAllowance: now.allowance,
      workingDates,
      halfDays,
    });
  }

  const below = await teamBelow(
    tx,
    member,
    span.from,
    span.to,
    [{ personId: member.personId, span, status: 'pending' }],
    excluding,
  );

  const borrowing = negative.verdict.kind === 'borrow' ? negative.verdict.approvers : [];
  const chain = resolveApprovers(await tx.approvals.rules(), await tx.approvals.autoApproval(), {
    subject: 'request',
    action: input.action,
    leaveTypeKey: def.key,
    category: def.category,
    paid: def.paid,
    workingDays: cost,
    belowZero: borrowing.length > 0,
    hasManager: member.managerPersonId !== null,
    teamAboveMinimum: below.length === 0,
  });
  const approvers = [...new Set([...chain, ...borrowing])];

  return ok({
    member,
    leaveType,
    span: { ...span, workingDays: cost },
    daysAway: daysAway(span, calendar),
    balance,
    belowMinimum: below,
    blocked: (policy?.definition.requests.blockBelowMinimum ?? false) && below.length > 0,
    negative,
    approvers,
    approver: approvers[0] === 'manager' ? member.managerPersonId : null,
    calendar,
    policyVersion: policy?.version ?? null,
  });
}

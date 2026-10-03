import type { CalendarDate, TenantId } from '@kithena/contracts';

import type { Triage } from '../../domain/approval/triage.js';
import type { DayCoverage } from '../../domain/coverage/coverage.js';
import { amount, days } from '../../domain/days.js';
import type { Member, RequestRecord, Tx } from '../ports.js';
import { teamCoverage } from '../request/assess.js';
import { balanceFor } from '../shared.js';
import type { Writer } from './ports.js';
import { written, type Line, type Written } from './written.js';
import { dayCount, listOf, shortDate } from './words.js';

/**
 * The one line beside each request in the approvals queue (TOF-086, T16,
 * MT15, §9.2). The rule decides the group; the line only says why, from the
 * numbers the domain computed for that rule: what is left, the team's worst
 * day, the days below the minimum.
 *
 * Sick leave is never shown to a model, whatever the rule: that someone is
 * off sick is health data, so its line is always the template. Nor is a name:
 * each requester is a placeholder (`{p0}`) filled in after.
 */

export interface ReasonFacts {
  readonly requestId: string;
  readonly firstName: string;
  readonly sick: boolean;
  readonly unit: 'day' | 'hour';
  /** What the request costs, in its unit. */
  readonly cost: string;
  /** What was left before it, in its unit; `null` for an untracked type. */
  readonly left: string | null;
  readonly triage: Triage;
  /** The team's fewest in on any of its days, `null` with no minimum. */
  readonly worst: DayCoverage | null;
}

export async function reasonFacts(
  tx: Tx,
  record: RequestRecord,
  member: Member,
  triage: Triage,
  today: CalendarDate,
): Promise<ReasonFacts> {
  const { request } = record;
  const span = request.pendingChange ?? request.span;
  const left = request.leaveType.tracked
    ? (await balanceFor(tx, member, request.leaveType.key, today, request.id)).left
    : null;
  const coverage = (
    await teamCoverage(
      tx,
      member,
      span.from,
      span.to,
      [{ personId: member.personId, span, status: 'pending' }],
      request.id,
    )
  ).filter((d) => d.checked);
  return {
    requestId: request.id,
    firstName: member.firstName,
    sick: request.leaveType.category === 'sick_leave',
    unit: request.leaveType.unit,
    cost: span.workingDays,
    left,
    triage,
    worst: coverage.toSorted((a, b) => a.in - b.in)[0] ?? null,
  };
}

const hours = (value: string): string => `${amount(value).replace(/\.?0+$/u, '')}h`;
const plain = (value: string): string => amount(value).replace(/\.?0+$/u, '') || '0';

/** The line without a model. Names are fine here: nothing leaves the process. */
export function reasonTemplate(f: ReasonFacts): string {
  const who = f.firstName;
  if (f.triage.group === 'look_closer') {
    const r = f.triage.reason;
    switch (r.rule) {
      case 'below_minimum': {
        const worst = f.worst;
        return worst === null
          ? `Below the team minimum on ${listOf(r.days.map(shortDate))}.`
          : `${listOf(r.days.map(shortDate))}: ${String(worst.in)} of ${String(worst.of)} in, below the ${String(worst.required)} the team needs.`;
      }
      case 'below_zero':
        return `Would take ${who} to −${plain(r.by)} days. Needs HR after you.`;
      case 'over_banked':
        return `${hours(r.short)} more than ${who} has banked.`;
      case 'protected_period':
        return `Falls in a protected period on ${listOf(r.days.map(shortDate))}.`;
      case 'sick_over_threshold':
        return `${dayCount(plain(r.days))} off sick, so a note is needed.`;
    }
  }
  if (f.sick) return 'Self-certified, under the days that need a note.';
  if (f.unit === 'hour' && f.left !== null) {
    return `Uses ${hours(f.cost)} of the ${hours(f.left)} ${who} has banked.`;
  }
  const after = f.left === null ? null : plain(amount(days(f.left).minus(f.cost)));
  const team =
    f.worst === null ? '' : `Team stays at ${String(f.worst.in)} of ${String(f.worst.of)}. `;
  return after === null
    ? `${team}Nothing needs a second look.`.trim()
    : `${team}${who} has ${dayCount(after)} left after this.`;
}

/** What the model may know about one request: the rule and its numbers, never a name or sickness. */
function factsOf(f: ReasonFacts, key: string): Record<string, unknown> {
  const rule = f.triage.group === 'clear' ? 'clear' : f.triage.reason.rule;
  const reason = f.triage.group === 'look_closer' ? f.triage.reason : null;
  return {
    line: key,
    who: `{${key}}`,
    group: f.triage.group,
    rule,
    unit: f.unit,
    asks: plain(f.cost),
    leftBefore: f.left === null ? null : plain(f.left),
    leftAfter: f.left === null ? null : plain(amount(days(f.left).minus(f.cost))),
    team:
      f.worst === null
        ? null
        : {
            fewestIn: f.worst.in,
            of: f.worst.of,
            needs: f.worst.required,
            on: shortDate(f.worst.date),
          },
    daysBelowMinimum:
      reason?.rule === 'below_minimum' || reason?.rule === 'protected_period'
        ? reason.days.map(shortDate)
        : [],
    belowZeroBy: reason?.rule === 'below_zero' ? plain(reason.by) : null,
    hoursShort: reason?.rule === 'over_banked' ? plain(reason.short) : null,
  };
}

export async function writeReasons(
  writer: Writer | undefined,
  tenantId: TenantId,
  all: readonly ReasonFacts[],
): Promise<{ readonly requestId: string; readonly text: Written }[]> {
  const asked = all.filter((f) => !f.sick);
  const keys = new Map(asked.map((f, i) => [f.requestId, `p${String(i)}`]));
  const lines: Record<string, Line> = Object.fromEntries(
    asked.map((f) => [
      keys.get(f.requestId) ?? '',
      {
        about:
          'Why this request is clear to approve, or what to look at, in under 16 words, ' +
          'naming the person by their placeholder.',
        template: reasonTemplate(f),
      },
    ]),
  );
  const out = await written(
    writer,
    tenantId,
    {
      instruction:
        'A manager sees their approvals queue. The group each request is in was decided by a rule; ' +
        'write the one line that says why, from its figures.',
      facts: { requests: asked.map((f) => factsOf(f, keys.get(f.requestId) ?? '')) },
    },
    lines,
    Object.fromEntries(asked.map((f) => [keys.get(f.requestId) ?? '', f.firstName])),
  );
  return all.map((f) => {
    const key = keys.get(f.requestId);
    return {
      requestId: f.requestId,
      text: (key === undefined ? undefined : out[key]) ?? { text: reasonTemplate(f), ai: false },
    };
  });
}

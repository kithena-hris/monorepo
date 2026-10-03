import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DayAmount, PersonId } from '@kithena/contracts';

import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { addMonths, days } from '../../domain/days.js';
import { whatChanged } from '../../domain/insights/insights.js';
import { nextBridge } from '../../domain/insights/nudge.js';
import type { Caller, Deps, Member, Tx } from '../ports.js';
import { forbidden, refuse, transact } from '../shared.js';
import { annualFacts, DEFAULT_COHORT_MINIMUM, scopeOf } from './insights.js';

/**
 * Nudging people to rest (T28, PRD §14.2): from the insight "N people haven't
 * taken a day off since June" to one message each, sent through
 * `platform/messaging`.
 *
 * **Each message carries only its recipient's data**: their own days left,
 * a day that bridges a holiday where they work, what they would lose at the
 * year end. Nothing about anybody else is ever passed to the writer. The
 * domain picks the people and finds their day; the writer only says it —
 * `templatedNudge` until the assistant's writer lands, and its fallback after.
 */

export interface NudgeInclude {
  /** Their own days left this year. */
  readonly balance: boolean;
  /** A day that joins a holiday to a weekend, for them. */
  readonly bridge: boolean;
  /** What the year end would take from them. */
  readonly losing: boolean;
}

/** One recipient's own figures, and nobody else's. */
export interface NudgeFacts {
  readonly firstName: string;
  readonly since: CalendarDate;
  readonly left: DayAmount;
  readonly losesAtYearEnd: DayAmount;
  readonly yearEnd: CalendarDate;
  readonly bridge: {
    readonly take: CalendarDate;
    readonly from: CalendarDate;
    readonly to: CalendarDate;
    readonly holiday: string;
  } | null;
}

export type NudgeWriter = (
  facts: NudgeFacts,
  include: NudgeInclude,
) => { heading: string; lede: string };

const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const at = (date: CalendarDate): Date => new Date(`${date}T00:00:00Z`);
const say = (n: DayAmount): string => days(n).toString();

/** The templated writer: the recipient's own numbers in plain sentences. */
export const templatedNudge: NudgeWriter = (facts, include) => {
  const lines: string[] = [];
  if (include.balance) lines.push(`You have ${say(facts.left)} days left this year.`);
  if (include.bridge && facts.bridge !== null) {
    lines.push(
      `Taking ${dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(at(facts.bridge.take))} gives you 4 days off with ${facts.bridge.holiday}.`,
    );
  }
  if (include.losing && days(facts.losesAtYearEnd).gt(0)) {
    lines.push(
      `${say(facts.losesAtYearEnd)} of them would be lost on ${dateFormat({ day: 'numeric', month: 'long' }).format(at(facts.yearEnd))} if they stay unbooked.`,
    );
  }
  lines.push('A few days away do more than they look. Nobody else sees this message.');
  return {
    heading: `${facts.firstName}, you haven’t had a day off since ${dateFormat({ month: 'long' }).format(at(facts.since))}`,
    lede: lines.join(' '),
  };
};

interface Recipient {
  readonly member: Member;
  readonly facts: NudgeFacts;
}

/** Who the insight counts as without a break, in the caller's scope, with their own figures. */
async function recipients(
  tx: Tx,
  deps: Pick<Deps, 'authz' | 'clock'>,
  caller: Caller,
): Promise<Recipient[] | null> {
  const scope = await scopeOf(tx, deps, caller);
  if (scope === null) return null;
  const today = deps.clock.date('UTC');
  const since = addMonths(`${today.slice(0, 7)}-01` as CalendarDate, -4);
  const all = [];
  for (const m of scope.members) {
    const own = await annualFacts(tx, m, deps.clock.date(m.timeZone));
    all.push({ m, own });
  }
  const [tired] = whatChanged({
    facts: all.map(({ m, own }) => ({
      personId: m.personId,
      team: m.teamKey,
      hireDate: m.hireDate,
      ...own,
    })),
    months: [],
    since,
    cohortMinimum: DEFAULT_COHORT_MINIMUM,
  }).filter((p) => p.kind === 'no_break');
  const ids = new Set<PersonId>(tired?.kind === 'no_break' ? tired.personIds : []);
  const out: Recipient[] = [];
  for (const { m, own } of all) {
    if (!ids.has(m.personId)) continue;
    const keys = m.locationKey === null ? [] : await tx.holidays.assigned(m.locationKey);
    const layers = (await tx.holidays.layers()).filter((l) => keys.includes(l.key));
    const year = Number(today.slice(0, 4));
    const holidays = [...resolveHolidays(layers, year), ...resolveHolidays(layers, year + 1)];
    out.push({
      member: m,
      facts: {
        firstName: m.firstName,
        since,
        left: own.left,
        losesAtYearEnd: own.losesAtYearEnd,
        yearEnd: own.yearEnd,
        bridge: nextBridge(
          holidays,
          deps.clock.date(m.timeZone),
          own.requests.map((r) => r.request.span),
          own.yearEnd,
        ),
      },
    });
  }
  return out.toSorted((a, b) => a.member.displayName.localeCompare(b.member.displayName));
}

export interface NudgeView {
  readonly since: CalendarDate | null;
  readonly recipients: readonly {
    readonly personId: PersonId;
    readonly displayName: string;
    /** Whether messaging can reach them: a work email is known. */
    readonly reachable: boolean;
  }[];
  /** The first recipient's message as it would be sent, for the dialog's preview. */
  readonly preview: {
    readonly personId: PersonId;
    readonly displayName: string;
    readonly heading: string;
    readonly lede: string;
  } | null;
}

/** T28's dialog: who would be nudged, and one of their messages exactly as it would go. */
export const nudgePreview =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>, writer: NudgeWriter = templatedNudge) =>
  (caller: Caller, include: NudgeInclude): Promise<Result<NudgeView>> =>
    transact<NudgeView>(deps, caller.tenantId, async (tx) => {
      const found = await recipients(tx, deps, caller);
      if (found === null) return forbidden();
      const first = found[0];
      return ok({
        since: first?.facts.since ?? null,
        recipients: found.map((r) => ({
          personId: r.member.personId,
          displayName: r.member.displayName,
          reachable: r.member.workEmail !== null,
        })),
        preview:
          first === undefined
            ? null
            : {
                personId: first.member.personId,
                displayName: first.member.displayName,
                ...writer(first.facts, include),
              },
      });
    });

/** An origin a person's browser was on: `https://acme.app.kithena.com`, nothing after it. */
function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Send each recipient their own message (T28's "Send"), once a day each
 * whoever presses it. The link is their company's own origin, which
 * messaging checks again; somebody without a work email is counted, not
 * guessed at. HR, or a manager for their reports.
 */
export const sendNudges =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'mailer'>, writer: NudgeWriter = templatedNudge) =>
  async (
    caller: Caller,
    input: {
      readonly include: NudgeInclude;
      readonly companyName: string;
      readonly appOrigin: string;
    },
  ): Promise<Result<{ sent: number; unreachable: number; failed: number }>> => {
    const mailer = deps.mailer;
    if (mailer === undefined) {
      return refuse(
        'NUDGES_UNAVAILABLE',
        'Messaging is not set up for Time Off, so nothing was sent',
      );
    }
    const origin = originOf(input.appOrigin);
    if (origin === null) return refuse('BAD_REQUEST', 'Not an origin', ['appOrigin']);
    const found = await transact(deps, caller.tenantId, async (tx) => {
      const r = await recipients(tx, deps, caller);
      return r === null ? forbidden() : ok(r);
    });
    if (!found.ok) return found;
    const today = deps.clock.date('UTC');
    let sent = 0;
    let unreachable = 0;
    let failed = 0;
    for (const { member, facts } of found.value) {
      if (member.workEmail === null) {
        unreachable++;
        continue;
      }
      const words = writer(facts, input.include);
      const url =
        input.include.bridge && facts.bridge !== null
          ? `${origin}/time-off/request?from=${facts.bridge.take}&to=${facts.bridge.take}`
          : `${origin}/time-off/overview`;
      try {
        await mailer.send(caller.tenantId, {
          email: member.workEmail,
          url,
          companyName: input.companyName,
          dedupeKey: `nudge/${member.personId}/${today}`,
          ...words,
        });
        sent++;
      } catch {
        failed++;
      }
    }
    return ok({ sent, unreachable, failed });
  };

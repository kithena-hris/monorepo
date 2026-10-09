import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DayAmount, PersonId, TenantId } from '@kithena/contracts';

import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { addMonths, days } from '../../domain/days.js';
import { whatChanged } from '../../domain/insights/insights.js';
import { nextBridge } from '../../domain/insights/nudge.js';
import type { Writer } from '../assist/ports.js';
import { written } from '../assist/written.js';
import type { Caller, Deps, Member, Tx } from '../ports.js';
import { forbidden, refuse, transact } from '../shared.js';
import { annualFactsOf, DEFAULT_COHORT_MINIMUM, scopeOf } from './insights.js';

/**
 * Nudging people to rest (T28, PRD §14.2): from the insight "N people haven't
 * taken a day off since June" to one message each, sent through
 * `platform/messaging`.
 *
 * **Each message carries only its recipient's data**: their own days left,
 * a day that bridges a holiday where they work, what they would lose at the
 * year end. Nothing about anybody else is ever passed to the writer. The
 * domain picks the people and finds their day; the writer only says it —
 * `writeNudge`, the assistant's `Writer` through `written()`, with
 * `templatedNudge` wherever there is no model or its line does not hold up.
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

/** One recipient's message; `ai` when a model wrote any of it. */
export interface NudgeWords {
  readonly heading: string;
  readonly lede: string;
  readonly ai: boolean;
}

export type NudgeWriter = (
  tenantId: TenantId,
  facts: NudgeFacts,
  include: NudgeInclude,
) => Promise<NudgeWords>;

const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const at = (date: CalendarDate): Date => new Date(`${date}T00:00:00Z`);
const say = (n: DayAmount): string => days(n).toString();

/** Always the message's last words, whoever wrote the rest: the promise is the code's. */
const PRIVATE = 'Nobody else sees this message.';
const short = dateFormat({ weekday: 'short', day: 'numeric', month: 'short' });
const long = dateFormat({ day: 'numeric', month: 'long' });
const month = dateFormat({ month: 'long' });

/** The template: the recipient's own numbers in plain sentences. */
export const templatedNudge = (
  facts: NudgeFacts,
  include: NudgeInclude,
): { heading: string; lede: string } => {
  const lines: string[] = [];
  if (include.balance) lines.push(`You have ${say(facts.left)} days left this year.`);
  if (include.bridge && facts.bridge !== null) {
    lines.push(
      `Taking ${short.format(at(facts.bridge.take))} gives you 4 days off with ${facts.bridge.holiday}.`,
    );
  }
  if (include.losing && days(facts.losesAtYearEnd).gt(0)) {
    lines.push(
      `${say(facts.losesAtYearEnd)} of them would be lost on ${long.format(at(facts.yearEnd))} if they stay unbooked.`,
    );
  }
  lines.push(`A few days away do more than they look. ${PRIVATE}`);
  return {
    heading: `${facts.firstName}, you haven’t had a day off since ${month.format(at(facts.since))}`,
    lede: lines.join(' '),
  };
};

/**
 * The assistant's words for one recipient (TOF-098 on TOF-084), through
 * `written()`. The model is given only what the message may say: their own
 * figures, as far as HR chose to include them, and their name as `{who}`,
 * filled in after it answers. Nobody else's anything. The closing promise is
 * added by the code, so a model can never drop it.
 */
export const writeNudge =
  (writer: Writer | undefined): NudgeWriter =>
  async (tenantId, facts, include) => {
    const plain = templatedNudge(facts, include);
    if (writer === undefined) return { ...plain, ai: false };
    const bridge = include.bridge ? facts.bridge : null;
    const losing = include.losing && days(facts.losesAtYearEnd).gt(0);
    const out = await written(
      writer,
      tenantId,
      {
        instruction:
          'Write a short, kind note to one person who has not taken a day off in a while, ' +
          'encouraging them to rest. It is theirs alone; say only what the facts give.',
        facts: {
          who: '{who}',
          noDayOffSince: month.format(at(facts.since)),
          ...(include.balance ? { daysLeftThisYear: say(facts.left) } : {}),
          ...(bridge === null
            ? {}
            : {
                bridgeDay: short.format(at(bridge.take)),
                daysOffInARow: 4,
                holiday: bridge.holiday,
              }),
          ...(losing
            ? {
                daysLostIfUnbooked: say(facts.losesAtYearEnd),
                lostOn: long.format(at(facts.yearEnd)),
              }
            : {}),
        },
      },
      {
        heading: {
          about: 'A one-line heading addressed to {who}, saying how long since a day off.',
          template: plain.heading,
        },
        lede: {
          about: 'One or two sentences with the figures given, then why a few days away help.',
          template: plain.lede.slice(0, -PRIVATE.length).trim(),
        },
      },
      { who: facts.firstName },
    );
    return {
      heading: out.heading.text,
      lede: `${out.lede.text} ${PRIVATE}`,
      ai: out.heading.ai || out.lede.ai,
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
  const facts = await annualFactsOf(tx, scope.members, (m) => deps.clock.date(m.timeZone));
  const all = scope.members.flatMap((m) => {
    const own = facts.get(m.personId);
    return own === undefined ? [] : [{ m, own }];
  });
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
    /** A model wrote the words (PRD §14.1). */
    readonly ai: boolean;
  } | null;
}

/** T28's dialog: who would be nudged, and one of their messages exactly as it would go. */
export const nudgePreview =
  (
    deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'writer'>,
    writer: NudgeWriter = writeNudge(deps.writer),
  ) =>
  async (caller: Caller, include: NudgeInclude): Promise<Result<NudgeView>> => {
    const found = await transact(deps, caller.tenantId, async (tx) => {
      const r = await recipients(tx, deps, caller);
      return r === null ? forbidden() : ok(r);
    });
    if (!found.ok) return found;
    // Written once the transaction is over, so a model's latency never holds it open.
    const first = found.value[0];
    return ok({
      since: first?.facts.since ?? null,
      recipients: found.value.map((r) => ({
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
              ...(await writer(caller.tenantId, first.facts, include)),
            },
    });
  };

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
  (
    deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'mailer' | 'writer'>,
    writer: NudgeWriter = writeNudge(deps.writer),
  ) =>
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
      const { heading, lede } = await writer(caller.tenantId, facts, input.include);
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
          heading,
          lede,
        });
        sent++;
      } catch {
        failed++;
      }
    }
    return ok({ sent, unreachable, failed });
  };

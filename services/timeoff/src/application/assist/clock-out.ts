import { localDate } from '@kithena/domain-kit';
import { Instant, type CalendarDate, type PersonId, type TenantId } from '@kithena/contracts';

import { finishCandidates, type Sighting } from '../../domain/attendance/suggestion.js';
import type { Deps, Tx } from '../ports.js';
import { localMinutes } from '../zone.js';
import { clock } from './words.js';

/**
 * A suggested end time for a missed clock-out (TOF-089, T21, MT18, §11.4).
 *
 * The evidence is the person's own and nothing else: when their connected
 * calendar's events ended (`Deps.calendar`, none until TOF-110) and when they
 * last did something in Kithena that Time Off saw (a request sent). The
 * domain turns it into candidate times; TypeSafe, when there is a key, picks
 * the likeliest from the times and kinds of evidence only — no event title,
 * no name; otherwise the latest is the suggestion. No evidence, no
 * suggestion. Asked only for the person themselves: a manager reading the
 * timesheet sees none of it.
 */

export interface Evidence {
  readonly source: Sighting['source'];
  readonly at: Instant;
  /** What it was, for the person: "Billing v2 sync, Google Calendar". */
  readonly what: string;
}

export interface FinishSuggestion {
  readonly at: Instant;
  /** "18:05", in the person's zone. */
  readonly time: string;
  /** Whether a model chose this time among the candidates. */
  readonly ai: boolean;
  readonly evidence: readonly Evidence[];
}

/** What Time Off itself saw the person do on `date`: the requests they sent. Inside the transaction. */
export async function kithenaActivity(
  tx: Tx,
  personId: PersonId,
  date: CalendarDate,
  timeZone: string,
): Promise<Evidence[]> {
  return (await tx.requests.list({ personIds: [personId] }))
    .filter((r) => localDate(r.requestedAt, timeZone) === date)
    .map((r) => ({ source: 'kithena', at: r.requestedAt, what: 'You sent a time-off request' }));
}

const local = (at: string, timeZone: string): string => clock(localMinutes(new Date(at), timeZone));

export async function suggestFinish(
  deps: Pick<Deps, 'judge' | 'calendar'>,
  tenantId: TenantId,
  who: { readonly personId: PersonId; readonly timeZone: string },
  day: { readonly date: CalendarDate; readonly lastPunchAt: Instant },
  activity: readonly Evidence[],
): Promise<FinishSuggestion | null> {
  const events = deps.calendar
    ? await deps.calendar.events(tenantId, who.personId, day.date).catch(() => [])
    : [];
  const evidence: Evidence[] = [
    ...events.map((e) => ({
      source: 'calendar' as const,
      at: Instant.parse(e.endsAt),
      what: `${e.title}, ${e.calendar}`,
    })),
    ...activity,
  ];
  // ponytail: the day ends at local midnight as the last punch's offset has it; an hour out on a DST night.
  const last = Date.parse(day.lastPunchAt);
  const dayEnds = Instant.parse(
    new Date(last + (1440 - localMinutes(new Date(last), who.timeZone)) * 60_000).toISOString(),
  );
  const candidates = finishCandidates({ lastPunchAt: day.lastPunchAt, dayEnds, seen: evidence });
  const latest = candidates[0];
  if (latest === undefined) return null;

  let chosen = latest;
  let ai = false;
  if (deps.judge !== undefined && candidates.length > 1) {
    const options = Object.fromEntries(
      candidates.map((c, i) => [
        `t${String(i)}`,
        `${local(c.at, who.timeZone)}, from the ${c.source === 'calendar' ? 'end of a calendar event' : 'last action in the HR app'}`,
      ]),
    );
    const answer = (
      await deps.judge.choose(tenantId, {
        state: {
          lastClockPunch: local(day.lastPunchAt, who.timeZone),
          seen: evidence
            .toSorted((a, b) => a.at.localeCompare(b.at))
            .map((e) => ({ source: e.source, time: local(e.at, who.timeZone) })),
        },
        questions: {
          finished: {
            instructions:
              'An employee forgot to clock out. From when they were last seen working (`seen`), ' +
              'which time did they most likely finish work?',
            options,
          },
        },
      })
    ).get('finished');
    const picked = answer === undefined ? undefined : candidates[Number(answer.choice.slice(1))];
    if (picked !== undefined) {
      chosen = picked;
      ai = true;
    }
  }
  return {
    at: chosen.at,
    time: local(chosen.at, who.timeZone),
    ai,
    evidence: evidence.toSorted((a, b) => b.at.localeCompare(a.at)),
  };
}

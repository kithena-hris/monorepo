import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { localDate, type Clock } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import { personZone, placementOf } from '../../domain/org/calendar.js';
import { identityFactsOf, Person, type EventContext } from '../../domain/person/person.js';
import type { RecomputePerson } from '../completeness/recompute.js';
import type { Calendars } from '../org/org.js';
import type { TenantRoles } from '../roles/roles.js';
import type { PersonRepository } from '../person-repository.js';
import type { PersonAccess } from './person-access.js';
import type { PersonReader, PersonRecord } from './ports.js';
import type { InTenant } from './service.js';

/**
 * §8.1: a pre-hire becomes active on their start date, on their own calendar.
 *
 * Nothing else moves them: HR hires somebody for the 1st and on the 1st they
 * are still `pre_hire`, off the headcount and asked only for onboarding fields.
 * This is the job that starts them — the same transition a person would take
 * by hand, raising `status_changed` (reason `started`, effective from the start
 * date) and, for a linked person, `identity_facts_changed`, and re-judging
 * their completeness in the same transaction (PEO-102).
 *
 * **Whose day.** A start date on the 1st has begun in Auckland at 11:00 UTC on
 * the 30th and not in Los Angeles until 07:00 UTC on the 1st. So the candidate
 * list is bounded by the latest date anywhere on Earth right now (UTC+14),
 * and each candidate is then judged on their own day by the aggregate, which
 * refuses a start that has not arrived. Run hourly, that starts everybody
 * within an hour of their own midnight.
 *
 * **Bounded and idempotent.** At most `limit` people a run, earliest start
 * first; one transaction each, the row locked and the status re-read inside
 * it, so a second replica or a re-run finds nobody left to start. One person
 * refused or failing does not stop the rest.
 */

/** The pre-hires whose start date may have arrived somewhere. */
export interface Arrivals {
  due(
    tx: PostgresJsDatabase,
    tenantId: string,
    onOrBefore: string,
    limit: number,
  ): Promise<readonly string[]>;
}

export interface StartDeps {
  readonly inTenant: InTenant;
  readonly arrivals: Arrivals;
  readonly people: PersonRepository;
  readonly reader: PersonReader;
  readonly calendars: Calendars;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly completeness?: RecomputePerson;
  readonly limit?: number;
  /** Revokes a leaver's tenant roles as their access ends (PEO-109 × PEO-112). */
  readonly roles?: Pick<TenantRoles, 'accessEnded'>;
}

/** The furthest-ahead zone there is: its date is the latest date anywhere. */
const EARLIEST_ZONE = 'Pacific/Kiritimati';

const ACTOR: Actor = { kind: 'system', process: 'people-lifecycle' };

/** What one run of a lifecycle job did, for the log. */
interface Run {
  readonly waiting: number;
  readonly failed: readonly { personId: string; error: unknown }[];
}

export function startArrivals(
  deps: StartDeps,
): (tenantId: string, correlationId: string) => Promise<Run & { readonly started: number }> {
  const run = lifecycleJob(deps, deps.arrivals, true, (record, person, zone, ctx) => {
    if (record.snapshot.status !== 'pre_hire' || !person.start(ctx, zone).ok) return false;
    person.shareIdentityFacts(
      identityFactsOf({ ...record.values, hire_date: person.hireDate }),
      ctx,
      person.hireDate,
    );
    return true;
  });
  return async (tenantId: string, correlationId: string) => {
    const { moved, ...rest } = await run(tenantId, correlationId);
    return { started: moved, ...rest };
  };
}

/** People on notice or terminated whose access has not ended, and whose last day may have ended somewhere. */
export interface Leavers {
  due(
    tx: PostgresJsDatabase,
    tenantId: string,
    /** A last working day before this date has ended somewhere on Earth. */
    before: string,
    limit: number,
  ): Promise<readonly string[]>;
}

/**
 * PEO-109: access ends with employment, at the end of the last working day on
 * the leaver's own calendar.
 *
 * The same shape as starting: candidates bounded by the latest date anywhere,
 * each judged on their own day by the aggregate, which refuses a day still
 * going on. Auckland's 30th ends at 11:00 UTC on the 30th and Los Angeles's at
 * 07:00 UTC on the 1st; run hourly, each ends within an hour of their own
 * midnight, and `endedAt` is that midnight either way. Once per leaving:
 * `access_ended_at` is written with the event, and the row is locked and
 * re-read before either. On notice as well as terminated: the end of the last
 * working day ends access whether or not HR has confirmed the termination.
 */
export function endAccessDue(
  deps: Omit<StartDeps, 'arrivals'> & { readonly leavers: Leavers },
): (tenantId: string, correlationId: string) => Promise<Run & { readonly ended: number }> {
  const run = lifecycleJob(
    deps,
    deps.leavers,
    false,
    (record, person, zone, ctx) =>
      (record.snapshot.status === 'terminated' || record.snapshot.status === 'notice') &&
      person.endAccess(ctx, zone, 'day_ended').ok,
  );
  return async (tenantId: string, correlationId: string) => {
    const { moved, ...rest } = await run(tenantId, correlationId);
    return { ended: moved, ...rest };
  };
}

/**
 * One hourly move, bounded and idempotent: candidates by the latest date
 * anywhere, then one transaction each with the row locked and re-read, judged
 * on the person's own calendar. One refused or failing does not stop the rest.
 */
function lifecycleJob(
  deps: Omit<StartDeps, 'arrivals'>,
  candidates: Arrivals | Leavers,
  /** Whether the move can change what completeness asks (a status did). */
  rejudge: boolean,
  act: (record: PersonRecord, person: Person, zone: string, ctx: EventContext) => boolean,
) {
  return async (
    tenantId: string,
    correlationId: string,
  ): Promise<Run & { readonly moved: number }> => {
    const latest = localDate(deps.clock.instant(), EARLIEST_ZONE);
    const due = await deps.inTenant(tenantId, ({ tx }) =>
      candidates.due(tx, tenantId, latest, deps.limit ?? 500),
    );

    let moved = 0;
    const failed: { personId: string; error: unknown }[] = [];
    for (const personId of due) {
      // eslint-disable-next-line no-await-in-loop -- one transaction at a time is the bound
      const done = await deps
        .inTenant(tenantId, async ({ tx }) => {
          const record = await deps.reader.record(tx, tenantId, personId, true);
          if (!record) return false;

          const at = deps.clock.instant();
          const zone = personZone(
            await deps.calendars.load(tx, tenantId),
            placementOf(record.values),
            at,
          );
          const ctx: EventContext = {
            clock: deps.clock,
            newEventId: deps.newId,
            actor: ACTOR,
            correlationId,
            causationId: null,
          };
          const person = Person.rehydrate(record.snapshot);
          if (!act(record, person, zone, ctx)) return false;
          await deps.people.save(tx, person);
          // Access ended by this move: the leaver's tenant roles end with it.
          const account = person.identityAccountId;
          const endedNow =
            (record.snapshot.accessEndedAt ?? null) === null && person.accessEndedAt !== null;
          if (endedNow && account !== null) {
            await deps.roles?.accessEnded(tx, {
              tenantId,
              accountId: account,
              correlationId,
              causationId: null,
            });
          }
          if (rejudge) {
            await deps.completeness?.(tx, {
              tenantId,
              personId,
              actor: ACTOR,
              correlationId,
              causationId: null,
            });
          }
          return true;
        })
        .catch((error: unknown) => {
          failed.push({ personId, error });
          return false;
        });
      if (done) moved += 1;
    }
    return { moved, waiting: due.length - moved - failed.length, failed };
  };
}

/**
 * PEO-124: a value dated ahead comes into force on its day, on the person's
 * own calendar (§8.5).
 *
 * A write dated ahead is history at once and the projection only on its day.
 * This is the job that moves it, hourly, in PEO-104's shape: candidates are
 * people with a scheduled row dated on or before the latest date anywhere on
 * Earth (UTC+14) and after their watermark; each is then judged on their own
 * day by `PersonAccess.bringIntoForce`, which brings in only what has arrived
 * there. Run hourly, a manager change dated the 1st lands within an hour of
 * midnight in Auckland, and eleven hours later in Los Angeles.
 *
 * **Bounded and idempotent.** At most `limit` people a run, one transaction
 * each, the row locked; what is brought in is what history holds in force and
 * the row does not, so a rerun or a second replica finds nothing to do. The
 * watermark (`people.person.applied_through`) is then set to the person's
 * day, which takes them off the candidate list until their next scheduled
 * row. One person refused or failing does not stop the rest.
 */

/** People with a scheduled value that may have arrived somewhere, and their watermark. */
export interface Scheduled {
  due(
    tx: PostgresJsDatabase,
    tenantId: string,
    onOrBefore: string,
    limit: number,
  ): Promise<readonly string[]>;
  /** Every dated value on or before `day` is in this person's row. */
  through(tx: PostgresJsDatabase, tenantId: string, personId: string, day: string): Promise<void>;
}

export interface EffectiveDeps {
  readonly inTenant: InTenant;
  readonly scheduled: Scheduled;
  readonly access: Pick<PersonAccess, 'bringIntoForce'>;
  readonly clock: Clock;
  readonly limit?: number;
}


export function bringDueIntoForce(deps: EffectiveDeps) {
  return async (
    tenantId: string,
    correlationId: string,
  ): Promise<{
    readonly applied: number;
    readonly failed: readonly { personId: string; error: unknown }[];
  }> => {
    const latest = localDate(deps.clock.instant(), EARLIEST_ZONE);
    const due = await deps.inTenant(tenantId, ({ tx }) =>
      deps.scheduled.due(tx, tenantId, latest, deps.limit ?? 500),
    );

    let applied = 0;
    const failed: { personId: string; error: unknown }[] = [];
    for (const personId of due) {
      // eslint-disable-next-line no-await-in-loop -- one transaction at a time is the bound
      await deps
        .inTenant(tenantId, async ({ tx }) => {
          const brought = await deps.access.bringIntoForce(tx, { tenantId, personId, correlationId });
          // Thrown so the transaction rolls back: nothing half-applied.
          if (!brought.ok) throw new Refused(brought.error.code, brought.error.message);
          await deps.scheduled.through(tx, tenantId, personId, brought.value.day);
          applied += brought.value.applied;
        })
        .catch((error: unknown) => {
          failed.push({ personId, error });
        });
    }
    return { applied, failed };
  };
}

/** A person the domain refused on the day, with its code for the log. */
class Refused extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

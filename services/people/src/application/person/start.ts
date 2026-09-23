import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { localDate, type Clock } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import { personZone, placementOf } from '../../domain/org/calendar.js';
import { identityFactsOf, Person, type EventContext } from '../../domain/person/person.js';
import type { RecomputePerson } from '../completeness/recompute.js';
import type { Calendars } from '../org/org.js';
import type { PersonRepository } from '../person-repository.js';
import type { PersonReader } from './ports.js';
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
}

/** The furthest-ahead zone there is: its date is the latest date anywhere. */
const EARLIEST_ZONE = 'Pacific/Kiritimati';

const ACTOR: Actor = { kind: 'system', process: 'people-lifecycle' };

export function startArrivals(deps: StartDeps) {
  return async (
    tenantId: string,
    correlationId: string,
  ): Promise<{
    started: number;
    waiting: number;
    failed: readonly { personId: string; error: unknown }[];
  }> => {
    const latest = localDate(deps.clock.instant(), EARLIEST_ZONE);
    const due = await deps.inTenant(tenantId, ({ tx }) =>
      deps.arrivals.due(tx, tenantId, latest, deps.limit ?? 500),
    );

    let started = 0;
    const failed: { personId: string; error: unknown }[] = [];
    for (const personId of due) {
      // eslint-disable-next-line no-await-in-loop -- one transaction at a time is the bound
      const moved = await deps.inTenant(tenantId, async ({ tx }) => {
        const record = await deps.reader.record(tx, tenantId, personId, true);
        if (!record || record.snapshot.status !== 'pre_hire') return false;

        const at = deps.clock.instant();
        const zone = personZone(await deps.calendars.load(tx, tenantId), placementOf(record.values), at);
        const ctx: EventContext = {
          clock: deps.clock,
          newEventId: deps.newId,
          actor: ACTOR,
          correlationId,
          causationId: null,
        };
        const person = Person.rehydrate(record.snapshot);
        if (!person.start(ctx, zone).ok) return false;
        person.shareIdentityFacts(
          identityFactsOf({ ...record.values, hire_date: person.hireDate }),
          ctx,
          person.hireDate,
        );
        await deps.people.save(tx, person);
        await deps.completeness?.(tx, {
          tenantId,
          personId,
          actor: ACTOR,
          correlationId,
          causationId: null,
        });
        return true;
      }).catch((error: unknown) => {
        failed.push({ personId, error });
        return false;
      });
      if (moved) started += 1;
    }
    return { started, waiting: due.length - started - failed.length, failed };
  };
}

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  err,
  failure,
  fixedClock,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import {
  assessCompleteness,
  gapsByOwner,
  type CompletenessState,
  type CompletenessVerdict,
  type MissingAttribute,
} from '../../domain/person/completeness.js';
import { personZone } from '../../domain/org/calendar.js';
import type { Calendars } from '../org/org.js';
import { clockAsOf, computeImpact, type EvaluablePerson } from '../schema/impact.js';
import type { PeopleFactsReader, SchemaRepository } from '../schema/schema-repository.js';
import type { CompletenessStore, Gap } from './store.js';

/**
 * §8.4: after a publish, re-evaluate everybody and say who became incomplete.
 *
 * **The number has to be the one the admin was shown.** The preview in
 * `publish-schema.ts` walks `PeopleFactsReader.forImpact` and classifies each
 * person with `computeImpact`; this walks the same reader and classifies each
 * person with the same function, one person at a time. A recompute that
 * decided "newly incomplete" any other way would agree with the preview until
 * the first conditional requirement and then quietly stop.
 *
 * Bounded in memory rather than in time: people stream through in pages and
 * are written back a batch at a time, so a 50,000-person tenant holds one batch
 * at once. The run is one transaction, which makes it all-or-nothing — a
 * crash halfway through leaves nobody half-notified.
 *
 * `ponytail: one transaction per tenant run. If a large tenant's run holds row
 * locks long enough to be felt on profile edits, commit per batch; `setState`
 * already makes a re-run raise nothing twice, so a partial run is resumable.`
 */

export interface RecomputeRequest {
  readonly tenantId: string;
  readonly schemaVersion: number;
  readonly actor: Actor;
  readonly correlationId: string;
  /** The `schema.published` event this run answers. */
  readonly causationId: string | null;
}

export interface RecomputeSummary {
  readonly evaluated: number;
  readonly becameIncomplete: number;
  readonly becameComplete: number;
  /** True when a later version was already in force and this run did nothing. */
  readonly superseded: boolean;
}

export interface RecomputeDeps {
  readonly schema: SchemaRepository;
  readonly people: PeopleFactsReader;
  readonly store: CompletenessStore;
  readonly clock: Clock;
  readonly newEventId: () => string;
  readonly batchSize?: number;
  /** Whose day each person is on; must be what the preview read. */
  readonly calendars: Calendars;
}

export type RecomputeCompleteness = (
  tx: PostgresJsDatabase,
  request: RecomputeRequest,
) => Promise<Result<RecomputeSummary>>;

export function recomputeCompleteness(deps: RecomputeDeps): RecomputeCompleteness {
  const batchSize = deps.batchSize ?? 500;

  return async (tx, request) => {
    const { tenantId, schemaVersion } = request;

    /*
     * A redelivered or late `schema.published` for version 3 arriving after
     * version 4's run would put every record back to version 3's verdict.
     * The later run already covers it.
     */
    const current = await deps.schema.currentVersion(tx, tenantId);
    if (current !== null && current.version > schemaVersion) {
      return ok({ evaluated: 0, becameIncomplete: 0, becameComplete: 0, superseded: true });
    }

    const published = await deps.store.versionAt(tx, tenantId, schemaVersion);
    if (published === null) {
      return err(
        failure('VERSION_NOT_FOUND', `Schema version ${String(schemaVersion)} was never published`),
      );
    }
    const after = published.attributes;
    const before =
      schemaVersion > 1
        ? ((await deps.store.versionAt(tx, tenantId, schemaVersion - 1))?.attributes ?? [])
        : [];

    /*
     * Evaluate at the instant the preview evaluated at, as recorded on the
     * version, and each person on their own calendar (PRD §6.8) — not today
     * in UTC. The event that starts this run arrives whenever it arrives, and
     * at 01:00 in Auckland "today in UTC" is yesterday: a field required from
     * today would be in the preview's count and missing from this one. A
     * version from before the instant was recorded replays its one date; one
     * from before either falls back to the clock.
     */
    const clock =
      published.evaluatedAt !== null
        ? fixedClock(published.evaluatedAt)
        : published.evaluatedOn !== null
          ? clockAsOf(deps.clock, published.evaluatedOn)
          : deps.clock;
    const calendar = await deps.calendars.load(tx, tenantId);
    const at = clock.instant();
    let evaluated = 0;
    let becameIncomplete = 0;
    let becameComplete = 0;

    const flush = async (batch: readonly EvaluablePerson[]): Promise<void> => {
      const judged = batch.map((person) => {
        // The preview's own classification, asked about one person.
        const impact = computeImpact(before, after, [person], clock, calendar);
        return {
          personId: person.personId,
          verdict: assessCompleteness(
            after,
            person.facts,
            clock,
            personZone(calendar, person.placement, at),
          ),
          becameIncomplete: impact.becomingIncomplete === 1,
          becameComplete: impact.becomingComplete === 1,
        };
      });
      const raised = await settle(tx, deps, request, schemaVersion, judged);
      evaluated += batch.length;
      becameIncomplete += raised.becameIncomplete;
      becameComplete += raised.becameComplete;
    };

    let batch: EvaluablePerson[] = [];
    for await (const person of deps.people.forImpact(tx, tenantId, batchSize)) {
      batch.push(person);
      if (batch.length >= batchSize) {
        await flush(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await flush(batch);

    return ok({ evaluated, becameIncomplete, becameComplete, superseded: false });
  };
}

/** One person's verdict, and whether it is a transition worth an event. */
interface Judged {
  readonly personId: string;
  readonly verdict: CompletenessVerdict;
  readonly becameIncomplete: boolean;
  readonly becameComplete: boolean;
}

type Cause = Pick<RecomputeRequest, 'tenantId' | 'actor' | 'correlationId' | 'causationId'>;

/**
 * Store verdicts and raise what changed: the one write path for both the
 * publish run and the one-person run, so the two cannot drift apart.
 *
 * An event goes out only when the stored state actually moved, which is what
 * makes a redelivery, or a second write that changes nothing, raise nothing.
 */
async function settle(
  tx: PostgresJsDatabase,
  deps: Pick<RecomputeDeps, 'store' | 'clock' | 'newEventId'>,
  cause: Cause,
  schemaVersion: number,
  judged: readonly Judged[],
): Promise<{ becameIncomplete: number; becameComplete: number }> {
  const { tenantId } = cause;
  const byState: Record<CompletenessState, string[]> = {
    complete: [],
    incomplete: [],
    not_applicable: [],
  };
  const gaps: Gap[] = [];
  for (const { personId, verdict } of judged) {
    byState[verdict.state].push(personId);
    const owners = gapsByOwner(verdict);
    gaps.push({
      personId,
      employeeKeys: owners.employee.map((m) => m.key),
      staffKeys: owners.staff.map((m) => m.key),
    });
  }

  const changedToIncomplete = await deps.store.setState(
    tx,
    tenantId,
    'incomplete',
    byState.incomplete,
  );
  const changedToComplete = await deps.store.setState(tx, tenantId, 'complete', byState.complete);
  await deps.store.setState(tx, tenantId, 'not_applicable', byState.not_applicable);

  const events: PendingEvent[] = [];
  for (const j of judged) {
    if (j.becameIncomplete && changedToIncomplete.has(j.personId)) {
      events.push(
        event(cause, deps, j.personId, 'people.person.profile_incomplete', {
          personId: j.personId,
          missing: j.verdict.missing.map((m: MissingAttribute) => ({
            key: m.key,
            sectionKey: m.sectionKey,
            owners: m.owners,
          })),
          schemaVersion,
        }),
      );
    }
    if (j.becameComplete && changedToComplete.has(j.personId)) {
      events.push(
        event(cause, deps, j.personId, 'people.person.profile_completed', {
          personId: j.personId,
          schemaVersion,
        }),
      );
    }
  }

  await deps.store.saveGaps(tx, tenantId, schemaVersion, gaps);
  await deps.store.publish(tx, events);
  return {
    becameIncomplete: events.filter((e) => e.eventName === 'people.person.profile_incomplete')
      .length,
    becameComplete: events.filter((e) => e.eventName === 'people.person.profile_completed').length,
  };
}

/**
 * §8.4 again, for one person, after their record changed (PEO-102).
 *
 * A field filled, cleared or corrected, a hire, a start, a status corrected
 * back: each can move the verdict, and a verdict read only at publish goes
 * stale — the gap row keeps asking for a field somebody filled an hour ago,
 * and the reminder goes out anyway. So every write path calls this in its
 * own transaction, and it evaluates exactly as the publish run does: the same
 * reader, the same `assessCompleteness`, the person's own day, the same
 * `settle`. Only "was" differs — here it is the stored state, since the
 * version did not change and the record did.
 *
 * `profile_incomplete` when a record that was not incomplete now is (a hire
 * with gaps included); `profile_completed` only when an incomplete one
 * closed. A write that leaves the state where it was raises nothing, and the
 * gap row is rewritten either way, so a filled field leaves the reminder's
 * list at once and an empty list is never reminded.
 */
export type RecomputePerson = (
  tx: PostgresJsDatabase,
  request: Cause & { readonly personId: string },
) => Promise<void>;

export function recomputePerson(
  deps: Omit<RecomputeDeps, 'batchSize'>,
): RecomputePerson {
  return async (tx, request) => {
    const current = await deps.schema.currentVersion(tx, request.tenantId);
    if (current === null) return;
    let person: EvaluablePerson | undefined;
    for await (const one of deps.people.forImpact(tx, request.tenantId, 1, request.personId)) {
      person = one;
    }
    if (person === undefined) return;

    const was = await deps.store.stateOf(tx, request.tenantId, request.personId);
    const calendar = await deps.calendars.load(tx, request.tenantId);
    const verdict = assessCompleteness(
      current.document.attributes,
      person.facts,
      deps.clock,
      personZone(calendar, person.placement, deps.clock.instant()),
    );
    await settle(tx, deps, request, current.version, [
      {
        personId: request.personId,
        verdict,
        becameIncomplete: verdict.state === 'incomplete' && was !== 'incomplete',
        becameComplete: verdict.state === 'complete' && was === 'incomplete',
      },
    ]);
  };
}

function event(
  request: Cause,
  deps: Pick<RecomputeDeps, 'clock' | 'newEventId'>,
  personId: string,
  eventName: string,
  payload: Record<string, unknown>,
): PendingEvent {
  return {
    eventId: deps.newEventId(),
    eventName,
    eventVersion: 1,
    tenantId: request.tenantId as PendingEvent['tenantId'],
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'Person', id: personId, version: 1 },
    actor: request.actor,
    correlationId: request.correlationId,
    causationId: request.causationId,
    payload,
  };
}

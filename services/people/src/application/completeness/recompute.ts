import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import {
  assessCompleteness,
  gapsByOwner,
  type CompletenessState,
  type MissingAttribute,
} from '../../domain/person/completeness.js';
import { computeImpact, type EvaluablePerson } from '../schema/impact.js';
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
  /** The tenant's calendar, for `requiredFrom`. Must match what the preview used. */
  readonly timeZone?: string;
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

    const after = await deps.store.definitionsAt(tx, tenantId, schemaVersion);
    if (after === null) {
      return err(
        failure('VERSION_NOT_FOUND', `Schema version ${String(schemaVersion)} was never published`),
      );
    }
    const before =
      schemaVersion > 1
        ? ((await deps.store.definitionsAt(tx, tenantId, schemaVersion - 1)) ?? [])
        : [];

    const timeZone = request.timeZone ?? 'Etc/UTC';
    let evaluated = 0;
    let becameIncomplete = 0;
    let becameComplete = 0;

    const flush = async (batch: readonly EvaluablePerson[]): Promise<void> => {
      const byState: Record<CompletenessState, string[]> = {
        complete: [],
        incomplete: [],
        not_applicable: [],
      };
      const newlyIncomplete = new Map<string, readonly MissingAttribute[]>();
      const newlyComplete: string[] = [];
      const gaps: Gap[] = [];

      for (const person of batch) {
        // The preview's own classification, asked about one person.
        const impact = computeImpact(before, after, [person], deps.clock, timeZone);
        const verdict = assessCompleteness(after, person.facts, deps.clock, timeZone);

        byState[verdict.state].push(person.personId);
        const owners = gapsByOwner(verdict);
        gaps.push({
          personId: person.personId,
          employeeKeys: owners.employee.map((m) => m.key),
          staffKeys: owners.staff.map((m) => m.key),
        });

        if (impact.becomingIncomplete === 1) newlyIncomplete.set(person.personId, verdict.missing);
        if (impact.becomingComplete === 1) newlyComplete.push(person.personId);
      }

      const changedToIncomplete = await deps.store.setState(
        tx,
        tenantId,
        'incomplete',
        byState.incomplete,
      );
      const changedToComplete = await deps.store.setState(
        tx,
        tenantId,
        'complete',
        byState.complete,
      );
      await deps.store.setState(tx, tenantId, 'not_applicable', byState.not_applicable);

      const events: PendingEvent[] = [];
      for (const [personId, missing] of newlyIncomplete) {
        if (!changedToIncomplete.has(personId)) continue;
        events.push(
          event(request, deps, personId, 'people.person.profile_incomplete', {
            personId,
            missing: missing.map((m) => ({
              key: m.key,
              sectionKey: m.sectionKey,
              owners: m.owners,
            })),
            schemaVersion,
          }),
        );
      }
      for (const personId of newlyComplete) {
        if (!changedToComplete.has(personId)) continue;
        events.push(
          event(request, deps, personId, 'people.person.profile_completed', {
            personId,
            schemaVersion,
          }),
        );
      }

      await deps.store.saveGaps(tx, tenantId, schemaVersion, gaps);
      await deps.store.publish(tx, events);

      evaluated += batch.length;
      becameIncomplete += events.filter(
        (e) => e.eventName === 'people.person.profile_incomplete',
      ).length;
      becameComplete += events.filter(
        (e) => e.eventName === 'people.person.profile_completed',
      ).length;
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

function event(
  request: RecomputeRequest,
  deps: RecomputeDeps,
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

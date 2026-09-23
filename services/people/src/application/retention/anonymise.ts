import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import { TenantId, type Actor, type FieldPolicy } from '@kithena/contracts';

import { dueForAnonymisation, type RetentionDecision } from './schedule.js';

/**
 * Anonymise what a leaver's retention periods allow, and say so.
 *
 * One person per call, in the caller's transaction, so a nightly job is a
 * bounded loop over terminated records rather than one statement over a
 * tenant. Only values actually held are cleared, which makes a re-run a no-op
 * rather than a second `people.person.anonymised` for the same fields.
 *
 * `ponytail: current values only. An encrypted attribute is skipped because
 * svc_people has no DELETE on people.person_secret, and history keeps its
 * values because people.person_attribute_history is append-only by trigger.
 * Both need a migration this ticket does not own.`
 */

export interface RetentionAttribute {
  readonly key: string;
  readonly policy: FieldPolicy;
  readonly encrypted: boolean;
}

/** Reads and writes for the job. Every method takes the caller's tenant transaction. */
export interface RetentionStore {
  leaver(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
  ): Promise<{
    readonly status: string;
    readonly lastWorkingDay: string | null;
    /** Keys that currently hold a value, in `custom` or a typed column. */
    readonly held: ReadonlySet<string>;
  } | null>;
  /** Every attribute the tenant has published, each with its most recent policy. */
  policies(tx: PostgresJsDatabase, tenantId: string): Promise<readonly RetentionAttribute[]>;
  /** Clear these keys and write the events, together. */
  clear(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
    keys: readonly string[],
    events: readonly PendingEvent[],
  ): Promise<void>;
}

export interface AnonymiseRequest {
  readonly tenantId: string;
  readonly personId: string;
  readonly actor: Actor;
  readonly correlationId: string;
  /** The tenant's calendar, for "today". */
  readonly timeZone?: string;
}

export function anonymiseDue(deps: {
  readonly store: RetentionStore;
  readonly clock: Clock;
  readonly newEventId: () => string;
}): (tx: PostgresJsDatabase, request: AnonymiseRequest) => Promise<Result<{ cleared: readonly string[] }>> {
  return async (tx, request) => {
    const { tenantId, personId } = request;
    const leaver = await deps.store.leaver(tx, tenantId, personId);
    if (!leaver) return err(failure('PERSON_NOT_FOUND', 'No such person', ['personId']));
    if (leaver.status !== 'terminated' || leaver.lastWorkingDay === null) return ok({ cleared: [] });

    const attributes = await deps.store.policies(tx, tenantId);
    const due = dueForAnonymisation(
      attributes.filter((a) => !a.encrypted),
      leaver.lastWorkingDay,
      deps.clock.date(request.timeZone ?? 'Etc/UTC'),
    ).filter((d) => leaver.held.has(d.key));

    if (due.length === 0) return ok({ cleared: [] });

    // One event per reason, because the event names one: an auditor asks
    // "was this law or configuration", and a mixed answer would be neither.
    const events = (['tenant_policy', 'statutory_floor'] as const)
      .map((under) => [under, due.filter((d) => d.under === under)] as const)
      .filter(([, decisions]) => decisions.length > 0)
      .map(([under, decisions]) => event(under, decisions, request, deps));

    const keys = due.map((d) => d.key);
    await deps.store.clear(tx, tenantId, personId, keys, events);
    return ok({ cleared: keys });
  };
}

function event(
  under: RetentionDecision['under'],
  decisions: readonly RetentionDecision[],
  request: AnonymiseRequest,
  deps: { readonly clock: Clock; readonly newEventId: () => string },
): PendingEvent {
  return {
    eventId: deps.newEventId(),
    eventName: 'people.person.anonymised',
    eventVersion: 1,
    tenantId: TenantId.parse(request.tenantId),
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'Person', id: request.personId, version: 1 },
    actor: request.actor,
    correlationId: request.correlationId,
    causationId: null,
    payload: {
      personId: request.personId,
      classesCleared: [...new Set(decisions.map((d) => d.classification))],
      attributeKeys: decisions.map((d) => d.key),
      under,
    },
  };
}

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  err,
  failure,
  localDate,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { TenantId, type Actor, type FieldPolicy } from '@kithena/contracts';

import { personZone, type Placement } from '../../domain/org/calendar.js';
import { mayErase, type ErasureMode } from '../../domain/retention/floors.js';
import { forgetImportReports, type StoredReports } from '../import/commit.js';
import type { Calendars } from '../org/org.js';
import { dueForAnonymisation, type RetentionDecision } from './schedule.js';

/**
 * Anonymise what a leaver's retention periods allow, and say so.
 *
 * One person per call, in the caller's transaction, so a nightly job is a
 * bounded loop over terminated records rather than one statement over a
 * tenant. Only values actually held are cleared, which makes a re-run a no-op
 * rather than a second `people.person.anonymised` for the same fields.
 *
 * Erased in all three places a value lives: the person row (a typed column or
 * `custom`), `people.person_secret` for an encrypted one, and every history
 * row for the key, corrections included. History rows are redacted rather
 * than deleted — the trigger in 20260923140000_people_retention.sql allows
 * exactly that — so the timeline keeps its dates and actors and loses only
 * what the value was.
 *
 * And a fourth: every stored import report that contains the person is
 * deleted whole (PEO-090). A report is the blocked rows as uploaded, so it
 * holds their values too, and redacting a CSV in object storage is not a
 * thing worth trusting; it is a working copy, and it goes.
 *
 * **An unreviewed statutory floor stops it** (PEO-126). An `automated` run
 * that would clear anything whose policy names a floor counsel has not yet
 * reviewed clears nothing and says so; only a `manual` run — HR, this one
 * person, a stated reason carried on the event — acts on one.
 */

export interface RetentionAttribute {
  readonly key: string;
  readonly policy: FieldPolicy;
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
    /** Whose calendar the due date is read on (PRD §6.8). */
    readonly placement: Placement;
    /**
     * Keys that still hold a value anywhere: `custom`, a typed column, a
     * secret, or an unredacted history row.
     */
    readonly held: ReadonlySet<string>;
  } | null>;
  /** Every attribute the tenant has published, each with its most recent policy. */
  policies(tx: PostgresJsDatabase, tenantId: string): Promise<readonly RetentionAttribute[]>;
  /** Erase these keys from the row, the secrets and the history, and write the events, together. */
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
  /** A job's run is `automated`; HR acting by hand for this person is `manual`, with a reason. */
  readonly mode: ErasureMode;
}

export function anonymiseDue(deps: {
  readonly store: RetentionStore;
  readonly clock: Clock;
  readonly newEventId: () => string;
  /** */
  readonly calendars: Calendars;
  /** Import reports, deleted when they contain the person anonymised. */
  readonly reports: StoredReports;
}): (tx: PostgresJsDatabase, request: AnonymiseRequest) => Promise<Result<{ cleared: readonly string[] }>> {
  return async (tx, request) => {
    const { tenantId, personId } = request;
    const leaver = await deps.store.leaver(tx, tenantId, personId);
    if (!leaver) return err(failure('PERSON_NOT_FOUND', 'No such person', ['personId']));
    if (leaver.status !== 'terminated' || leaver.lastWorkingDay === null) return ok({ cleared: [] });

    const attributes = await deps.store.policies(tx, tenantId);
    // Due on the leaver's own calendar: "48 months after the last day" ends
    // at midnight where they worked, not where the server is (PRD §6.8).
    const at = deps.clock.instant();
    const calendar = await deps.calendars.load(tx, tenantId);
    const today = localDate(at, personZone(calendar, leaver.placement, at));
    const due = dueForAnonymisation(attributes, leaver.lastWorkingDay, today).filter((d) =>
      leaver.held.has(d.key),
    );

    if (due.length === 0) return ok({ cleared: [] });

    const floors = due.flatMap((d) => (d.floor === null ? [] : [d.floor]));
    const allowed = mayErase(floors, request.mode);
    if (!allowed.ok) return allowed;

    // One event per reason, because the event names one: an auditor asks
    // "was this law or configuration", and a mixed answer would be neither.
    const events = (['tenant_policy', 'statutory_floor'] as const)
      .map((under) => [under, due.filter((d) => d.under === under)] as const)
      .filter(([, decisions]) => decisions.length > 0)
      .map(([under, decisions]) => event(under, decisions, request, deps));

    const keys = due.map((d) => d.key);
    await deps.store.clear(tx, tenantId, personId, keys, events);
    await forgetImportReports(tx, deps.reports, tenantId, personId);
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
      ...(request.mode.kind === 'manual' ? { manualReason: request.mode.reason.trim() } : {}),
    },
  };
}

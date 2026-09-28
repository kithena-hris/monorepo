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
import type { PhotoStore } from '../screens/photo-store.js';

/** Whose erasure takes the photo with it: the keys that name somebody. */
const NAMES: ReadonlySet<string> = new Set(['given_name', 'family_name', 'preferred_name']);
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
 *
 * **A merge's tombstones go with their survivor** (PEO-074). A tombstone is
 * the same human, so it is on the survivor's clock: it is never a leaver of
 * its own (its status is `merged`, so asked for directly nothing is due), and
 * whatever falls due for the survivor is erased from every tombstone merged
 * into it, however many merges deep, in the same transaction and under the
 * same floors. Each erased tombstone gets its own `people.person.anonymised`
 * naming the survivor.
 */

export interface RetentionAttribute {
  readonly key: string;
  readonly policy: FieldPolicy;
}

/** Reads and writes for the job. Every method takes the caller's tenant transaction. */
export interface RetentionStore {
  /** Locked for update unless `lock` is false, which is for a read that erases nothing. */
  leaver(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
    lock?: boolean,
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
  /** Every tombstone merged into this person, directly or through another tombstone (PEO-074). */
  tombstones(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<readonly string[]>;
  /**
   * Leavers who may hold a value due by `today` (+1 day for time zones): left
   * at least `shortestMonths` ago, and holding one of `keys` themselves or in
   * a tombstone. A superset — `anonymiseDue` decides. Keyset by id, after
   * `after`, at most `limit`.
   */
  candidates(
    tx: PostgresJsDatabase,
    tenantId: string,
    query: {
      readonly today: string;
      readonly shortestMonths: number;
      readonly keys: readonly string[];
      readonly after: string | null;
      readonly limit: number;
    },
  ): Promise<readonly { readonly personId: string; readonly name: string | null; readonly lastWorkingDay: string }[]>;
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
  /** Their photo, deleted with their name: a face outlives nothing a name does not. */
  readonly photos?: Pick<PhotoStore, 'remove'>;
  /** Counsel's reviews of the floors; `FLOOR_REVIEWS` unless a test says otherwise. */
  readonly reviews?: Parameters<typeof mayErase>[2];
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
    // The survivor's clock, over what the survivor and its tombstones hold.
    const tombstones: { readonly id: string; readonly held: ReadonlySet<string> }[] = [];
    for (const id of await deps.store.tombstones(tx, tenantId, personId)) {
      // eslint-disable-next-line no-await-in-loop -- a merge or two per person
      const t = await deps.store.leaver(tx, tenantId, id);
      if (t) tombstones.push({ id, held: t.held });
    }
    const heldAnywhere = new Set([...leaver.held, ...tombstones.flatMap((t) => [...t.held])]);
    const due = dueForAnonymisation(attributes, leaver.lastWorkingDay, today).filter((d) =>
      heldAnywhere.has(d.key),
    );

    if (due.length === 0) return ok({ cleared: [] });

    const floors = due.flatMap((d) => (d.floor === null ? [] : [d.floor]));
    const allowed = mayErase(floors, request.mode, deps.reviews);
    if (!allowed.ok) return allowed;

    const cleared = new Set<string>();
    for (const { id, held, survivorId } of [
      { id: personId, held: leaver.held, survivorId: null },
      ...tombstones.map((t) => ({ ...t, survivorId: personId })),
    ]) {
      const mine = due.filter((d) => held.has(d.key));
      if (mine.length === 0) continue;
      // One event per reason, because the event names one: an auditor asks
      // "was this law or configuration", and a mixed answer would be neither.
      const events = (['tenant_policy', 'statutory_floor'] as const)
        .map((under) => [under, mine.filter((d) => d.under === under)] as const)
        .filter(([, decisions]) => decisions.length > 0)
        .map(([under, decisions]) =>
          event(under, decisions, { ...request, personId: id }, survivorId, deps),
        );
      const keys = mine.map((d) => d.key);
      // eslint-disable-next-line no-await-in-loop -- the survivor, then a tombstone or two
      await deps.store.clear(tx, tenantId, id, keys, events);
      // eslint-disable-next-line no-await-in-loop -- as above
      await forgetImportReports(tx, deps.reports, tenantId, id);
      if (keys.some((k) => NAMES.has(k))) {
        // eslint-disable-next-line no-await-in-loop -- as above
        await deps.photos?.remove(tx, tenantId, id);
      }
      for (const k of keys) cleared.add(k);
    }
    return ok({ cleared: [...cleared] });
  };
}

function event(
  under: RetentionDecision['under'],
  decisions: readonly RetentionDecision[],
  request: AnonymiseRequest,
  survivorId: string | null,
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
      ...(request.mode.kind === 'manual'
        ? { manualReason: request.mode.reason.trim() }
        : { automatedReason: automatedReason(decisions) }),
      ...(survivorId === null ? {} : { survivorId }),
    },
  };
}

/** "retention expired (es-labour)": the floors that decided, or the tenant's policy. */
function automatedReason(decisions: readonly RetentionDecision[]): string {
  const why = new Set(
    decisions.map((d) => (d.under === 'statutory_floor' && d.floor !== null ? d.floor : 'tenant policy')),
  );
  return `retention expired (${[...why].join(', ')})`;
}

import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';
import { Actor } from '@kithena/contracts';

import type { PersonFields, PersonRepository } from '../application/person-repository.js';
import type {
  CurrentEmployment,
  EmploymentPeriodRow,
  LeavingReason,
  PersonSnapshot,
  PersonState,
} from '../domain/person/person.js';
import type { HistoryEntry } from '../domain/person/history.js';
import { employmentPeriod, person, personAttributeHistory } from './tables.js';

/**
 * The person repository, as Drizzle.
 *
 * One rule runs through every method here: **no path writes a person row
 * without draining the aggregate's events into the outbox in the same
 * transaction.** Debezium tails the WAL, so an event exists if and only if the
 * row committed — and the way that guarantee is lost is not a deliberate
 * decision, it is a second write method added later that "only touches one
 * column".
 *
 * There is no such method. `create` and `save` both drain, and the one thing
 * that can be written without an event is history, which travels with the
 * write that produced it.
 */

const outbox = outboxTable('people');

/** The columns the state machine owns. A caller cannot set these directly. */
type AggregateColumns = {
  status: PersonState;
  hireDate: string | null;
  lastWorkingDay: string | null;
  accessEndedAt: Date | null;
};

export function drizzlePersonRepository(): PersonRepository {
  return {
    async load(tx, tenantId, personId) {
      const rows = await tx
        .select(withEmployment)
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)))
        .limit(1);

      return toSnapshot(rows[0]);
    },

    async findByAccount(tx, tenantId, identityAccountId) {
      const rows = await tx
        .select(withEmployment)
        .from(person)
        .where(
          and(
            eq(person.tenantId, tenantId),
            eq(person.identityAccountId, identityAccountId),
          ),
        )
        .limit(1);

      return toSnapshot(rows[0]);
    },

    async create(tx, aggregate, fields) {
      const snapshot = aggregate.snapshot;

      await tx.insert(person).values({
        id: snapshot.id,
        tenantId: snapshot.tenantId,
        ...aggregateColumns(snapshot),
        identityAccountId: snapshot.identityAccountId,
        ...writable(fields),
      });

      // A record hired before it was first written carries its hire date's row.
      await insertHistory(tx, snapshot, aggregate.drainHistory());
      await writePeriod(tx, snapshot, aggregate.drainClosedPeriod());
      await writePeriod(tx, snapshot, aggregate.drainPeriod());

      // Same transaction as the row. That is the whole mechanism, and the
      // reason there is no `create` that skips it.
      await publish(tx, outbox, aggregate.drainEvents());
    },

    async save(tx, aggregate, change) {
      const snapshot = aggregate.snapshot;

      await tx
        .update(person)
        .set({ ...aggregateColumns(snapshot), ...writable(change?.fields) })
        .where(and(eq(person.tenantId, snapshot.tenantId), eq(person.id, snapshot.id)));

      /*
       * History before the outbox, so a history row can name the event that
       * produced it. Append-only: the table's trigger refuses an UPDATE, and
       * a correction is a new row carrying `supersedes`.
       */
      await insertHistory(tx, snapshot, [
        ...(change?.history ?? []),
        // The lifecycle's own dates, which a correction supersedes like any row.
        ...aggregate.drainHistory(),
      ]);
      // The current employment period, when the move changed it (PEO-110).
      await writePeriod(tx, snapshot, aggregate.drainClosedPeriod());
      await writePeriod(tx, snapshot, aggregate.drainPeriod());

      await publish(tx, outbox, aggregate.drainEvents());
    },

    async periods(tx, tenantId, personId) {
      const rows = await tx
        .select()
        .from(employmentPeriod)
        .where(and(eq(employmentPeriod.tenantId, tenantId), eq(employmentPeriod.personId, personId)))
        .orderBy(asc(employmentPeriod.period));
      return rows.map((r) => ({
        period: r.period,
        legalEntityId: r.legalEntityId,
        startedOn: r.startedOn,
        lastWorkingDay: r.lastWorkingDay,
        leavingReason: r.leavingReason as LeavingReason | null,
        eligibleForRehire: r.eligibleForRehire,
        noticeFrom: r.noticeFrom as CurrentEmployment['noticeFrom'],
        rehireOverrideReason: r.rehireOverrideReason,
      }));
    },

    async history(tx, tenantId, personId, attributeKey) {
      const rows = await tx
        .select()
        .from(personAttributeHistory)
        .where(
          attributeKey === undefined
            ? and(
                eq(personAttributeHistory.tenantId, tenantId),
                eq(personAttributeHistory.personId, personId),
              )
            : and(
                eq(personAttributeHistory.tenantId, tenantId),
                eq(personAttributeHistory.personId, personId),
                eq(personAttributeHistory.attributeKey, attributeKey),
              ),
        )
        .orderBy(asc(personAttributeHistory.effectiveFrom), asc(personAttributeHistory.recordedAt));

      return rows.map((row) => ({
        id: row.id,
        attributeKey: row.attributeKey,
        value: row.value,
        effectiveFrom: row.effectiveFrom,
        recordedAt: row.recordedAt.toISOString(),
        // Parsed rather than asserted: the column is JSONB, so what comes back
        // is whatever was written, and a domain reading `actor.kind` off an
        // unchecked value is one bad row away from a crash in a retention job.
        actor: Actor.parse(row.actor),
        supersedes: row.supersedes,
        eventId: row.eventId,
      }));
    },
  };
}

async function insertHistory(
  tx: PostgresJsDatabase,
  snapshot: PersonSnapshot,
  entries: readonly HistoryEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(personAttributeHistory).values(
    entries.map((entry) => ({
      id: entry.id,
      tenantId: snapshot.tenantId,
      personId: snapshot.id,
      attributeKey: entry.attributeKey,
      value: entry.value ?? null,
      effectiveFrom: entry.effectiveFrom,
      recordedAt: new Date(entry.recordedAt),
      actor: entry.actor,
      supersedes: entry.supersedes,
      eventId: entry.eventId ?? null,
    })),
  );
}

function aggregateColumns(snapshot: PersonSnapshot): AggregateColumns {
  return {
    status: snapshot.status,
    hireDate: snapshot.hireDate,
    lastWorkingDay: snapshot.lastWorkingDay,
    accessEndedAt: snapshot.accessEndedAt ? new Date(snapshot.accessEndedAt) : null,
  };
}

/**
 * The fields a caller may set, with `undefined` meaning "leave it".
 *
 * Drizzle writes every key present in the object, so passing the whole patch
 * through would null every column the caller did not mention — a profile
 * update that blanked a manager, a cost centre and a start date because the
 * form only asked about a phone number.
 */
function writable(fields: PersonFields | undefined): Record<string, unknown> {
  if (!fields) return {};
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/**
 * The current employment period's facts, as one column beside the person's:
 * the latest period, or null for a record with none (PEO-110). A scalar
 * subquery, so a `FOR UPDATE` on the person row locks only that row.
 * `person` below is the outer row: written out, because Drizzle renders a
 * column unqualified and inside the subquery that would name `p`'s own.
 */
export const currentEmployment = sql<Record<string, unknown> | null>`(
  SELECT jsonb_build_object(
           'period', p.period,
           'legalEntityId', p.legal_entity_id,
           'leavingReason', p.leaving_reason,
           'eligibleForRehire', p.eligible_for_rehire,
           'noticeFrom', p.notice_from,
           'rehireOverrideReason', p.rehire_override_reason,
           'startedOn', p.started_on)
    FROM people.employment_period p
   WHERE p.tenant_id = person.tenant_id AND p.person_id = person.id
   ORDER BY p.period DESC
   LIMIT 1)`.as('employment');

/** Every person column, and the current period's facts. */
export const withEmployment = { ...getTableColumns(person), employment: currentEmployment };

/** The JSON `currentEmployment` reads, as the aggregate's; null for none, which the domain reads by date. */
export function toEmployment(value: Record<string, unknown> | null): CurrentEmployment | null {
  if (value === null) return null;
  return {
    period: Number(value['period']),
    legalEntityId: (value['legalEntityId'] as string | null) ?? null,
    leavingReason: (value['leavingReason'] as LeavingReason | null) ?? null,
    eligibleForRehire: (value['eligibleForRehire'] as boolean | null) ?? null,
    noticeFrom: (value['noticeFrom'] as CurrentEmployment['noticeFrom']) ?? null,
    rehireOverrideReason: (value['rehireOverrideReason'] as string | null) ?? null,
    startedOn: (value['startedOn'] as string | null) ?? null,
  };
}

/** Insert or update one period row, in the write's transaction. */
async function writePeriod(
  tx: PostgresJsDatabase,
  snapshot: PersonSnapshot,
  row: EmploymentPeriodRow | null,
): Promise<void> {
  if (row === null) return;
  const values = {
    legalEntityId: row.legalEntityId,
    startedOn: row.startedOn,
    lastWorkingDay: row.lastWorkingDay,
    leavingReason: row.leavingReason,
    eligibleForRehire: row.eligibleForRehire,
    noticeFrom: row.noticeFrom,
    rehireOverrideReason: row.rehireOverrideReason,
  };
  await tx
    .insert(employmentPeriod)
    .values({ tenantId: snapshot.tenantId, personId: snapshot.id, period: row.period, ...values })
    .onConflictDoUpdate({
      target: [employmentPeriod.tenantId, employmentPeriod.personId, employmentPeriod.period],
      set: values,
    });
}

function toSnapshot(
  row: (typeof person.$inferSelect & { employment: Record<string, unknown> | null }) | undefined,
): PersonSnapshot | null {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status as PersonState,
    identityAccountId: row.identityAccountId,
    hireDate: row.hireDate,
    lastWorkingDay: row.lastWorkingDay,
    accessEndedAt: row.accessEndedAt?.toISOString() ?? null,
    employment: toEmployment(row.employment),
  };
}

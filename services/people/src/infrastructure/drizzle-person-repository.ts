import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';
import { Actor } from '@kithena/contracts';

import type { PersonFields, PersonRepository } from '../application/person-repository.js';
import type { PersonSnapshot, PersonState } from '../domain/person/person.js';
import type { HistoryEntry } from '../domain/person/history.js';
import { person, personAttributeHistory } from './tables.js';

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
};

export function drizzlePersonRepository(): PersonRepository {
  return {
    async load(tx, tenantId, personId) {
      const rows = await tx
        .select()
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)))
        .limit(1);

      return toSnapshot(rows[0]);
    },

    async findByAccount(tx, tenantId, identityAccountId) {
      const rows = await tx
        .select()
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

      await publish(tx, outbox, aggregate.drainEvents());
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

function toSnapshot(row: typeof person.$inferSelect | undefined): PersonSnapshot | null {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status as PersonState,
    identityAccountId: row.identityAccountId,
    hireDate: row.hireDate,
    lastWorkingDay: row.lastWorkingDay,
  };
}

import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';

import type { RetentionAttribute, RetentionStore } from '../application/retention/anonymise.js';
import { publishedAttributes } from './policy-registry.js';
import { attributeUnique, person, personSecret } from './tables.js';

const outbox = outboxTable('people');

/**
 * Columns retention never clears: identity of the row, the state machine's
 * own dates, and bookkeeping. A leaver's hire date and last day are what an
 * aggregate headcount for 2019 is counted from, and must survive.
 */
const STRUCTURAL = new Set([
  'id',
  'tenant_id',
  'identity_account_id',
  'status',
  'hire_date',
  'last_working_day',
  'custom',
  'schema_version',
  'completeness',
  'source_of_record',
  'created_at',
  'updated_at',
]);

/** Property name by column name, for the typed columns a retention policy may clear. */
const clearable = new Map(
  Object.entries(getTableColumns(person))
    .filter(([, column]) => !STRUCTURAL.has(column.name))
    .map(([prop, column]) => [column.name, prop] as const),
);

/**
 * Every tombstone merged into `personId`, however many merges deep (PEO-074):
 * a record absorbed into one that was itself absorbed later still points at
 * the one it was merged into, not at the last survivor.
 *
 * `ponytail: merged_into has no index, so each level is a scan of the tenant's
 * people. Merges are rare and shallow; index it if a tenant's merges are not.`
 */
export async function tombstonesOf(
  tx: PostgresJsDatabase,
  tenantId: string,
  personId: string,
): Promise<readonly string[]> {
  const rows = await tx.execute(sql`
    WITH RECURSIVE absorbed(id) AS (
      SELECT id FROM people.person WHERE tenant_id = ${tenantId}::uuid AND merged_into = ${personId}::uuid
      UNION
      SELECT p.id FROM people.person p JOIN absorbed a ON p.merged_into = a.id
       WHERE p.tenant_id = ${tenantId}::uuid
    )
    SELECT id FROM absorbed ORDER BY id
  `);
  return [...rows].map((r) => String(r['id']));
}

export function drizzleRetentionStore(): RetentionStore {
  return {
    async leaver(tx, tenantId, personId, lock = true) {
      const query = tx
        .select()
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)))
        .limit(1);
      // Locked, so a rehire (PEO-110) committing beside this run is either
      // seen — no longer terminated, nothing due — or waits for it.
      const rows = lock ? await query.for('update') : await query;
      const row = rows[0];
      if (!row) return null;

      const byProp = row as Record<string, unknown>;
      const held = new Set(Object.keys(row.custom ?? {}));
      for (const [name, prop] of clearable) {
        if (byProp[prop] !== null && byProp[prop] !== undefined) held.add(name);
      }

      // A value can outlive the row: in a secret, or in a history row the
      // projection has since moved past. Both count as held until erased.
      const [secrets, history] = await Promise.all([
        tx
          .select({ key: personSecret.attributeKey })
          .from(personSecret)
          .where(and(eq(personSecret.tenantId, tenantId), eq(personSecret.personId, personId))),
        tx.execute(sql`
          SELECT DISTINCT attribute_key AS key FROM people.person_attribute_history
           WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
             AND redacted_at IS NULL AND value IS NOT NULL
        `),
      ]);
      for (const s of secrets) held.add(s.key);
      for (const h of history) held.add(String(h['key']));
      const ownZone = (row.custom as Record<string, unknown> | null)?.['time_zone'];
      return {
        status: row.status,
        lastWorkingDay: row.lastWorkingDay,
        held,
        placement: {
          legalEntityId: row.legalEntityId,
          locationId: row.locationId,
          ownZone: typeof ownZone === 'string' ? ownZone : null,
        },
      };
    },

    tombstones: tombstonesOf,

    async candidates(tx, tenantId, { today, shortestMonths, keys, after, limit }) {
      // A typed column holding a value counts as held, like `custom`, a
      // secret or an unredacted history row; `leaver` then says exactly what.
      const columns = keys.filter((k) => clearable.has(k));
      const inColumn =
        columns.length === 0
          ? sql`false`
          : sql.join(
              columns.map((c) => sql`p.${sql.identifier(c)} IS NOT NULL`),
              sql` OR `,
            );
      const rows = await tx.execute(sql`
        WITH RECURSIVE human(root, id) AS (
          SELECT id, id FROM people.person
           WHERE tenant_id = ${tenantId}::uuid AND status = 'terminated'
             AND last_working_day IS NOT NULL
             -- Postgres clamps to a shorter month's end, as addMonths does;
             -- the extra day is the zone furthest ahead of UTC.
             AND last_working_day + make_interval(months => ${shortestMonths}) <= ${today}::date + 1
             AND (${after}::uuid IS NULL OR id > ${after}::uuid)
          UNION
          SELECT h.root, p.id FROM people.person p JOIN human h ON p.merged_into = h.id
           WHERE p.tenant_id = ${tenantId}::uuid
        )
        SELECT DISTINCT r.id AS person_id, r.last_working_day::text AS last_working_day,
               nullif(concat_ws(' ', r.given_name, r.family_name), '') AS name
          FROM human h
          JOIN people.person p ON p.tenant_id = ${tenantId}::uuid AND p.id = h.id
          JOIN people.person r ON r.tenant_id = ${tenantId}::uuid AND r.id = h.root
         WHERE p.custom ?| ${sql.param([...keys])}::text[]
            OR ${inColumn}
            OR EXISTS (SELECT 1 FROM people.person_secret s
                        WHERE s.tenant_id = p.tenant_id AND s.person_id = p.id
                          AND s.attribute_key = ANY(${sql.param([...keys])}::text[]))
            OR EXISTS (SELECT 1 FROM people.person_attribute_history ph
                        WHERE ph.tenant_id = p.tenant_id AND ph.person_id = p.id
                          AND ph.attribute_key = ANY(${sql.param([...keys])}::text[])
                          AND ph.redacted_at IS NULL AND ph.value IS NOT NULL)
         ORDER BY r.id
         LIMIT ${limit}
      `);
      return [...rows].map((r) => ({
        personId: String(r['person_id']),
        lastWorkingDay: String(r['last_working_day']),
        name: typeof r['name'] === 'string' ? r['name'] : null,
      }));
    },

    async policies(tx, tenantId) {
      // Later versions overwrite earlier ones, so each key carries its latest
      // policy — and a key a rollback dropped still carries its last one.
      const latest = new Map<string, RetentionAttribute>();
      for (const a of await publishedAttributes(tx, tenantId)) {
        latest.set(a.key, { key: a.key, policy: a.classification });
      }
      return [...latest.values()];
    },

    async clear(tx, tenantId, personId, keys, events) {
      const columns = Object.fromEntries(
        keys.flatMap((k) => {
          const prop = clearable.get(k);
          return prop ? [[prop, null]] : [];
        }),
      );
      const customKeys = keys.filter((k) => !clearable.has(k));

      await tx
        .update(person)
        .set({
          ...columns,
          custom: sql`${person.custom} - ${sql.param(customKeys)}::text[]`,
          updatedAt: new Date(),
        })
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)));

      await tx
        .delete(personSecret)
        .where(
          and(
            eq(personSecret.tenantId, tenantId),
            eq(personSecret.personId, personId),
            inArray(personSecret.attributeKey, [...keys]),
          ),
        );

      /*
       * The unique claim goes with the value (PEO-082). A keyed hash of an
       * erased national identifier is still that person's identifier to
       * whoever holds the key, and a claim held for a value nobody has would
       * refuse it to the next person who does.
       */
      await tx
        .delete(attributeUnique)
        .where(
          and(
            eq(attributeUnique.tenantId, tenantId),
            eq(attributeUnique.personId, personId),
            inArray(attributeUnique.attributeKey, [...keys]),
          ),
        );

      /*
       * Every row for the key, corrections included: a correction supersedes a
       * value, it does not remove it, so redacting only the latest row would
       * leave the original in the timeline. Raw SQL because the redaction
       * columns belong to this job alone and the shared table definition does
       * not need to know them. The trigger admits exactly this shape.
       */
      await tx.execute(sql`
        UPDATE people.person_attribute_history
           SET value = NULL, redacted_at = now(), redaction_reason = 'retention'
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
           AND attribute_key = ANY(${sql.param([...keys])}::text[])
           AND redacted_at IS NULL
      `);

      /*
       * A change once held for approval keeps its value as the audit of what
       * was asked (PEO-077); it goes with the value it would have changed. A
       * change still waiting cannot then be approved: there is nothing to apply.
       */
      await tx.execute(sql`
        UPDATE people.pending_change
           SET value = NULL, last4 = NULL, ciphertext = NULL, key_id = NULL
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
           AND attribute_key = ANY(${sql.param([...keys])}::text[])
      `);

      /*
       * The upstream system's ids for a leaver past retention go with their
       * values (PEO-072): a SCIM userName is usually their email, and an
       * externalId finds them in the provider. Unlinked, the provider's next
       * read of them is a 404, which is the truth.
       */
      await tx.execute(sql`
        DELETE FROM people.scim_group_member
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid`);
      await tx.execute(sql`
        DELETE FROM people.scim_link
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid`);

      // Same transaction as the write, like every other person write here.
      await publish(tx, outbox, events);
    },
  };
}

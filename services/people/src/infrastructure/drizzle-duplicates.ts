import { and, eq, sql } from 'drizzle-orm';

import type { DuplicateStore, Moved } from '../application/person/duplicates.js';
import { pairKey, type DuplicateSignal } from '../domain/person/merge.js';
import { attributeUnique, duplicateDecision } from './tables.js';

/**
 * Duplicate candidates and decisions (PEO-074), as SQL.
 *
 * Blocking is equality on what records already hold, per tenant, among live
 * records: the same work email, the same name with the same date of birth,
 * and a unique value's keyed hash held twice (a claim the key rotation found
 * in conflict, PEO-082). Nothing is decrypted: a sealed value is compared by
 * its HMAC or not at all, and a date of birth a tenant seals is not a signal.
 *
 * ponytail: two self-joins over the tenant's live rows, hashed; 50,000 people
 * is two sequential scans. Past that, keep a blocking key column with an index.
 */

const LIVE = sql`status NOT IN ('merged', 'discarded')`;

export function drizzleDuplicates(): DuplicateStore {
  return {
    async signals(tx, tenantId, limit) {
      const rows = await tx.execute<{
        a: string;
        b: string;
        signal: DuplicateSignal;
        attribute_key: string | null;
      }>(sql`
        WITH live AS (
          SELECT id,
                 lower(btrim(work_email)) AS email,
                 lower(btrim(given_name)) AS given,
                 lower(btrim(family_name)) AS family,
                 custom->>'date_of_birth' AS born
            FROM people.person
           WHERE tenant_id = ${tenantId}::uuid AND ${LIVE}
        )
        SELECT a, b, signal, attribute_key FROM (
          SELECT x.id AS a, y.id AS b, 'work_email' AS signal, NULL::text AS attribute_key
            FROM live x JOIN live y ON x.email = y.email AND x.id < y.id
           WHERE x.email <> ''
          UNION ALL
          SELECT x.id, y.id, 'name_and_birth_date', NULL
            FROM live x JOIN live y
              ON x.given = y.given AND x.family = y.family AND x.born = y.born AND x.id < y.id
           WHERE x.given <> '' AND x.family <> ''
          UNION ALL
          -- A record a SCIM connection provisioned, and another live record
          -- holding the email it arrived with: an adoption that could not be
          -- automatic (PEO-072), left to HR.
          SELECT x.id, y.id, 'scim_work_email', NULL
            FROM people.scim_link l
            JOIN live x ON x.id = l.person_id
            JOIN live y ON y.id <> x.id AND y.email <> ''
                       AND (y.email = x.email OR y.email = lower(btrim(l.user_name)))
           WHERE l.tenant_id = ${tenantId}::uuid
          UNION ALL
          SELECT u.person_id, u.conflict_with, 'unique_value', u.attribute_key
            FROM people.attribute_unique u
            JOIN live x ON x.id = u.person_id
            JOIN live y ON y.id = u.conflict_with
           WHERE u.tenant_id = ${tenantId}::uuid AND u.conflict_with IS NOT NULL
        ) s
        ${limit === null ? sql`` : sql`LIMIT ${limit}`}`);
      return [...rows].map((r) => ({
        a: r.a,
        b: r.b,
        signal: r.signal,
        attributeKey: r.attribute_key,
      }));
    },

    async decided(tx, tenantId) {
      // A pair whose latest decision is an undo is undecided again.
      const rows = await tx.execute<{ a: string; b: string }>(sql`
        SELECT person_a AS a, person_b AS b FROM (
          SELECT DISTINCT ON (person_a, person_b) person_a, person_b, decision
            FROM people.duplicate_decision
           WHERE tenant_id = ${tenantId}::uuid
           ORDER BY person_a, person_b, decided_at DESC, id DESC
        ) latest
         WHERE decision <> 'unmerged'`);
      return new Set([...rows].map((r) => pairKey(r.a, r.b)));
    },

    async merges(tx, tenantId, where) {
      const rows = await tx.execute<{
        id: string;
        survivor_id: string;
        absorbed_id: string;
        attributes_taken: string[];
        moved: Moved | null;
        decided_by: string;
        decided_at: Date | string;
      }>(sql`
        SELECT d.id, d.survivor_id, d.absorbed_id, d.attributes_taken, d.moved,
               d.decided_by, d.decided_at
          FROM people.duplicate_decision d
          JOIN people.person p ON p.tenant_id = d.tenant_id AND p.id = d.absorbed_id
         WHERE d.tenant_id = ${tenantId}::uuid AND d.decision = 'merged'
           AND p.status = 'merged' AND p.merged_into = d.survivor_id
           AND NOT EXISTS (
             SELECT 1 FROM people.duplicate_decision u
              WHERE u.tenant_id = d.tenant_id AND u.reverses = d.id)
           ${where.absorbedId === undefined ? sql`` : sql`AND d.absorbed_id = ${where.absorbedId}::uuid`}
           ${
             where.before === undefined
               ? sql``
               : sql`AND (d.decided_at, d.id) < (${where.before.at}::timestamptz, ${where.before.id}::uuid)`
           }
         ORDER BY d.decided_at DESC, d.id DESC
         LIMIT ${where.limit}`);
      return [...rows].map((r) => ({
        id: r.id,
        survivorId: r.survivor_id,
        absorbedId: r.absorbed_id,
        attributesTaken: r.attributes_taken,
        moved: r.moved,
        decidedBy: r.decided_by,
        decidedAt: new Date(r.decided_at).toISOString(),
      }));
    },

    async erased(tx, tenantId, personId) {
      const [row] = await tx.execute<{ erased: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM people.person_attribute_history
           WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
             AND redacted_at IS NOT NULL
        ) AS erased`);
      return row?.erased === true;
    },

    async record(tx, tenantId, decision) {
      const [a, b] = decision.personIds.toSorted();
      await tx
        .insert(duplicateDecision)
        .values({
          tenantId,
          id: decision.id,
          personA: a ?? '',
          personB: b ?? '',
          decision: decision.decision,
          survivorId: decision.survivorId ?? null,
          absorbedId: decision.absorbedId ?? null,
          attributesTaken: [...(decision.attributesTaken ?? [])],
          moved: decision.moved ?? null,
          reason: decision.reason ?? null,
          reverses: decision.reverses ?? null,
          decidedBy: decision.decidedBy,
          decidedAt: new Date(decision.decidedAt),
        })
        // A second "not a duplicate" for the same pair is the first one, retried.
        .onConflictDoNothing();
    },

    async releaseClaims(tx, tenantId, personId) {
      await tx
        .delete(attributeUnique)
        .where(and(eq(attributeUnique.tenantId, tenantId), eq(attributeUnique.personId, personId)));
    },

    async reports(tx, tenantId, personId) {
      const [row] = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM people.person
         WHERE tenant_id = ${tenantId}::uuid AND manager_id = ${personId}::uuid AND ${LIVE}`);
      return row?.n ?? 0;
    },

    async sameClaims(tx, tenantId, a, b) {
      const rows = await tx.execute<{ attribute_key: string }>(sql`
        SELECT DISTINCT x.attribute_key
          FROM people.attribute_unique x
          JOIN people.attribute_unique y
            ON y.tenant_id = x.tenant_id AND y.attribute_key = x.attribute_key
           AND y.key_id = x.key_id AND y.value_hash = x.value_hash
         WHERE x.tenant_id = ${tenantId}::uuid
           AND x.person_id = ${a}::uuid AND y.person_id = ${b}::uuid`);
      return [...rows].map((r) => r.attribute_key);
    },
  };
}

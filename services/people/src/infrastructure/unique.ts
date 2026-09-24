import { createHash, createHmac, hkdfSync } from 'node:crypto';

import { and, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TenantId, type AttributeDefinition } from '@kithena/contracts';
import { outboxTable, publish } from '@kithena/db-kit';
import {
  err,
  failure,
  ok,
  systemClock,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { uuidv7 } from '../application/person/ids.js';
import { claimText } from '../application/person/person-access.js';
import { drizzlePersonReader, drizzleSchemaVersions } from './drizzle-person-reader.js';
import { keysFrom, staticKeyRing, type KeyRing, type MasterKey } from './envelope.js';
import { drizzleSecretStore } from './secret-store.js';
import { drizzleIdentifierReviews } from './drizzle-identifier-reviews.js';
import { normaliseNationalId } from '../country-packs/national-id.js';
import { attributeUnique } from './tables.js';
import type { InTenantTransaction } from './unit-of-work.js';

/**
 * Uniqueness on a tenant-defined attribute, without runtime DDL.
 *
 * A customer who marks "Works council id" unique gets a real unique index
 * enforcing it — the one over `(value_hash, tenant_id, attribute_key,
 * scope_id)` on `people.attribute_unique`. Claiming a value is an INSERT
 * into that table in the same transaction as the value itself, so the claim
 * and the value commit together or not at all.
 *
 * **The claim holds a keyed hash, never the value** (PEO-082). HMAC-SHA-256
 * under a key derived per tenant, by HKDF, from the master key that wraps
 * secrets (`envelope.ts`). So a national identifier can be unique without its
 * plaintext sitting beside its ciphertext, and a dump of the table is a list
 * of 32-byte strings nobody can test a guess against without the master key.
 * An unkeyed SHA-256 would not do: a NIF is eight digits and a letter, and
 * 10^8 guesses is a coffee break. Employee numbers are hashed too — a
 * plaintext index of them is needless.
 *
 * The derived key is never stored. `key_id` on the row names the master key it
 * came from, which is what a rotation selects by.
 *
 * **Not `CREATE INDEX` at runtime.** That is the obvious implementation and it
 * is an outage with a settings screen in front of it: DDL against a
 * multi-tenant production table takes a lock every other tenant's reads queue
 * behind, at whatever moment an administrator happened to tick a box. It also
 * cannot be reviewed, cannot be rolled forward with the rest of a release, and
 * leaves a schema that differs per customer.
 *
 * Two checks rather than one — a SELECT first, then the index. The SELECT
 * produces a good error naming the person who already holds the value, and it
 * is the one that looks under every key the ring holds, which the index — one
 * key's hashes at a time — cannot. The index is what is true when two writers
 * under the same key race.
 */

/** Postgres, on a unique violation. */
const UNIQUE_VIOLATION = '23505';

/** HKDF `info`: names what the derived key is for, so it can never double as another. */
const CLAIM_KEY_INFO = 'kithena/people/unique-claim/v1';

const ROTATION_BATCH = 500;

const outbox = outboxTable('people');

/** One uniqueness rule: an attribute, within a legal entity or the whole tenant. */
export interface ClaimRule {
  readonly attributeKey: string;
  /** The legal entity for an entity-scoped rule; the tenant for a tenant-scoped one. */
  readonly scopeId: string;
}

export interface UniqueClaim extends ClaimRule {
  readonly value: string;
  readonly personId: string;
}

export interface ClaimConflict {
  readonly attributeKey: string;
  /** Who already holds it. Named because "that is taken" is not an answer HR can act on. */
  readonly heldBy: string;
}

/** A value two people hold, found by a rotation. Ids only. */
export interface RotationConflict {
  readonly attributeKey: string;
  /** Holds it under the current key. */
  readonly heldBy: string;
  /** Holds it under the retiring key, and keeps that claim until one of them changes. */
  readonly staleClaimBy: string;
}

/** Where a rotation batch stopped: the last claim it looked at. */
export interface RotationCursor {
  readonly personId: string;
  readonly attributeKey: string;
}

/**
 * The form of a value a claim is computed from, for comparison only.
 *
 * Trimmed and casefolded, so two employee numbers differing by a trailing
 * space are one collision rather than two records. Unicode-normalised first,
 * because `José` typed on a Mac and `José` pasted from a Windows export are
 * different byte sequences for the same name and a hash compares bytes.
 *
 * The *stored* value keeps whatever the person typed. This is only what the
 * claim is keyed on, and it is never stored either.
 */
export function normalise(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en');
}

/**
 * The claim for one normalised value, base64, as `value_hash` stores it.
 *
 * The key is per tenant, so equal values in two tenants hash apart. The
 * attribute and scope are in the message, so one person's NIF and NAF, or one
 * number in two legal entities, do not show up as equal either.
 */
export function claimHash(
  master: MasterKey,
  tenantId: string,
  claim: ClaimRule,
  normalisedValue: string,
): string {
  const key = Buffer.from(
    hkdfSync('sha256', master.key, Buffer.alloc(0), `${CLAIM_KEY_INFO}:${tenantId}`, 32),
  );
  try {
    return createHmac('sha256', key)
      .update(`${claim.attributeKey}\0${claim.scopeId}\0${normalisedValue}`)
      .digest('base64');
  } finally {
    key.fill(0);
  }
}

/** Where a rotation reads a claim's value back from. Null once the person no longer holds one. */
export type ClaimValue = (personId: string, attributeKey: string) => Promise<string | null>;

export interface UniqueClaims {
  /**
   * Take the lock for each rule, in one global order, before claiming under
   * any of them.
   *
   * A write claiming two unique attributes takes two locks. Taken in the
   * order the fields arrived, two writers naming the same two attributes in
   * opposite orders each hold one and wait for the other — a deadlock
   * Postgres breaks by failing one of them. Sorted, the second waits for the
   * first lock instead of holding one. `claim` takes its own rule's lock as
   * well; an advisory lock is re-entrant within a transaction, so that is free.
   */
  lock(tx: PostgresJsDatabase, tenantId: string, rules: readonly ClaimRule[]): Promise<void>;

  /**
   * Take a value for a person, or report who already holds it.
   *
   * A `Result` rather than a thrown error because a duplicate employee number
   * is an ordinary thing for an import to find several times in one file, and
   * the caller decides whether that blocks a row or merely flags it.
   */
  claim(
    tx: PostgresJsDatabase,
    tenantId: string,
    claim: UniqueClaim,
  ): Promise<Result<void, ReturnType<typeof failure> & { conflict?: ClaimConflict }>>;

  /**
   * Give up a claim, because the value changed or the record was discarded.
   *
   * Scoped to one attribute rather than to the person, so changing a works
   * council id does not release an employee number in the same breath.
   */
  release(
    tx: PostgresJsDatabase,
    tenantId: string,
    where: { personId: string; attributeKey: string },
  ): Promise<void>;

  /**
   * Re-key up to `limit` claims not yet under the ring's current key, after
   * `after`, which includes backfilling the ones written before PEO-082 in
   * plaintext. Fewer than `limit` seen means the tenant is done.
   *
   * A hash cannot be re-keyed without its value, so each is read back from
   * where the value lives, and a claim whose value is gone is released.
   * Idempotent: a row already under the current key is never selected.
   *
   * A value somebody else already holds under the current key is a duplicate
   * that predates the rotation. That claim is skipped, not failed: it stays
   * under the retiring key, still unique there, marked with who it collides
   * with. `conflicts` lists the ones marked for the first time, so each is
   * reported once; the cursor moves past them, so they never stall a batch.
   */
  rotate(
    tx: PostgresJsDatabase,
    tenantId: string,
    valueOf: ClaimValue,
    options?: { readonly limit?: number; readonly after?: RotationCursor | null },
  ): Promise<{
    readonly seen: number;
    readonly last: RotationCursor | null;
    readonly conflicts: readonly RotationConflict[];
  }>;
}

/** The advisory-lock key for a rule: the rule, never the value, so nothing about a value reaches `pg_locks`. */
function lockKey(tenantId: string, rule: ClaimRule): string {
  return `attribute_unique:${tenantId}:${rule.attributeKey}:${rule.scopeId}`;
}

export function drizzleUniqueClaims(ring: KeyRing): UniqueClaims {
  return {
    async lock(tx, tenantId, rules) {
      const keys = [...new Set(rules.map((rule) => lockKey(tenantId, rule)))].toSorted();
      for (const key of keys) {
        // In sequence: the order is the point.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      }
    },

    async claim(tx, tenantId, request) {
      const normalisedValue = normalise(request.value);
      if (normalisedValue === '') {
        return err(
          failure('UNIQUE_VALUE_EMPTY', `${request.attributeKey} cannot be blank and unique`, [
            request.attributeKey,
          ]),
        );
      }

      /*
       * One claimant at a time per rule. The unique index compares hashes
       * under one key, and mid-rotation — or mid-rollout, with replicas
       * holding different current keys — two writers can hash one value under
       * two keys and both pass it. Already held when the caller took `lock`.
       *
       * ponytail: one rule's claims serialise until commit, so an edit to an
       * attribute waits behind a long import claiming the same attribute.
       */
      await this.lock(tx, tenantId, [request]);

      // A person changing their own value releases the old claim first,
      // otherwise the second value collides with the first — with themselves.
      await this.release(tx, tenantId, {
        personId: request.personId,
        attributeKey: request.attributeKey,
      });

      // Every key the value may be held under, and the two plaintext forms a
      // claim written before PEO-082 holds until the rotation backfills it:
      // the value, or the unkeyed digest a sealed value was claimed by.
      const current = ring.current();
      const hashes = ring.all().map((key) => claimHash(key, tenantId, request, normalisedValue));
      const digest = createHash('sha256').update(normalisedValue).digest('hex');

      // One arm per form, each a lookup of one key in a unique index
      // (20260924350000). Not an `OR`, and not `= ANY(…)`: for a tenant the
      // statistics have not seen, either lets the planner walk the tenant's
      // claims instead, and a first import did that for every row.
      const holder = (match: SQL) =>
        tx
          .select({ personId: attributeUnique.personId })
          .from(attributeUnique)
          .where(
            and(
              eq(attributeUnique.tenantId, tenantId),
              eq(attributeUnique.attributeKey, request.attributeKey),
              eq(attributeUnique.scopeId, request.scopeId),
              match,
            ),
          );
      const held = await unionAll(
        holder(eq(attributeUnique.normalisedValue, normalisedValue)),
        holder(eq(attributeUnique.normalisedValue, digest)),
        ...hashes.map((hash) => holder(eq(attributeUnique.valueHash, hash))),
      ).limit(1);

      const existing = held[0];
      if (existing) {
        return err(
          Object.assign(
            failure('UNIQUE_VALUE_TAKEN', `${request.attributeKey} is already in use`, [
              request.attributeKey,
            ]),
            { conflict: { attributeKey: request.attributeKey, heldBy: existing.personId } },
          ),
        );
      }

      try {
        await tx.insert(attributeUnique).values({
          tenantId,
          attributeKey: request.attributeKey,
          scopeId: request.scopeId,
          valueHash: claimHash(current, tenantId, request, normalisedValue),
          keyId: current.id,
          personId: request.personId,
        });
      } catch (cause) {
        /*
         * The race the SELECT above cannot close.
         *
         * Two writers that did not take the lock above — an older replica —
         * with the same employee number, both past the SELECT before either
         * INSERT lands. The unique index refuses the second, and this turns
         * that into the same refusal the first path produces — because a
         * caller should not have to tell "somebody else holds it" from
         * "somebody else took it while I was asking".
         *
         * The conflict has no `heldBy` here: the winning row belongs to a
         * transaction that has not committed as far as this one can see, so
         * naming a holder would mean reading a row that might yet roll back.
         */
        if (isUniqueViolation(cause)) {
          return err(
            failure('UNIQUE_VALUE_TAKEN', `${request.attributeKey} is already in use`, [
              request.attributeKey,
            ]),
          );
        }
        throw cause;
      }

      return ok(undefined);
    },

    async release(tx, tenantId, where) {
      await tx
        .delete(attributeUnique)
        .where(
          and(
            eq(attributeUnique.tenantId, tenantId),
            eq(attributeUnique.personId, where.personId),
            eq(attributeUnique.attributeKey, where.attributeKey),
          ),
        );
    },

    async rotate(tx, tenantId, valueOf, options = {}) {
      const limit = options.limit ?? ROTATION_BATCH;
      const after = options.after ?? null;
      const current = ring.current();
      const stale = or(isNull(attributeUnique.keyId), ne(attributeUnique.keyId, current.id));
      const rows = await tx
        .select({
          attributeKey: attributeUnique.attributeKey,
          scopeId: attributeUnique.scopeId,
          personId: attributeUnique.personId,
        })
        .from(attributeUnique)
        .where(
          and(
            eq(attributeUnique.tenantId, tenantId),
            stale,
            after === null
              ? undefined
              : sql`(${attributeUnique.personId}, ${attributeUnique.attributeKey}) > (${after.personId}::uuid, ${after.attributeKey})`,
          ),
        )
        .orderBy(attributeUnique.personId, attributeUnique.attributeKey)
        .limit(limit);

      const conflicts: RotationConflict[] = [];
      for (const row of rows) {
        // In sequence, as `secret-store.ts` rotates: a background job with
        // nobody waiting has no business firing every row at the pool.
        const text = await valueOf(row.personId, row.attributeKey);
        const normalised = text === null ? '' : normalise(text);
        // Still stale: a writer that re-claimed since the read above wrote
        // under the current key, and must not be given the old value's hash.
        const where = and(
          eq(attributeUnique.tenantId, tenantId),
          eq(attributeUnique.personId, row.personId),
          eq(attributeUnique.attributeKey, row.attributeKey),
          stale,
        );
        if (normalised === '') {
          await tx.delete(attributeUnique).where(where);
          continue;
        }

        const valueHash = claimHash(current, tenantId, row, normalised);
        const [holder] = await tx
          .select({ personId: attributeUnique.personId })
          .from(attributeUnique)
          .where(
            and(
              eq(attributeUnique.tenantId, tenantId),
              eq(attributeUnique.attributeKey, row.attributeKey),
              eq(attributeUnique.scopeId, row.scopeId),
              eq(attributeUnique.valueHash, valueHash),
              ne(attributeUnique.personId, row.personId),
            ),
          )
          .limit(1);

        if (holder) {
          // Marked, and reported, only when new: the next run finds the same
          // pair and says nothing more.
          const marked = await tx
            .update(attributeUnique)
            .set({ conflictWith: holder.personId })
            .where(
              and(
                where,
                sql`${attributeUnique.conflictWith} IS DISTINCT FROM ${holder.personId}::uuid`,
              ),
            )
            .returning({ personId: attributeUnique.personId });
          if (marked.length > 0) {
            conflicts.push({
              attributeKey: row.attributeKey,
              heldBy: holder.personId,
              staleClaimBy: row.personId,
            });
          }
          continue;
        }

        await tx
          .update(attributeUnique)
          .set({ valueHash, keyId: current.id, normalisedValue: null, conflictWith: null })
          .where(where);
      }

      const tail = rows.at(-1);
      return {
        seen: rows.length,
        last: tail ? { personId: tail.personId, attributeKey: tail.attributeKey } : null,
        conflicts,
      };
    },
  };
}

/**
 * Whether a key rollout was skipped: a tenant with claims, none of them under
 * the current key yet, some under a key this ring does not hold.
 *
 * The rollout is two deploys (`.env.example`): the new key known but not
 * current, then current. Skip the first and a replica that never held the old
 * key cannot look under it, so a claim under it protects nothing. Re-keying
 * would repair the claims, but it would also paper over a deployment that
 * dropped a key it still needed — so the job refuses and says so, and the
 * service keeps running. Returns the missing key ids, or null.
 */
export async function rolloutSkipped(
  tx: PostgresJsDatabase,
  tenantId: string,
  ring: KeyRing,
): Promise<readonly string[] | null> {
  const rows = await tx
    .selectDistinct({ keyId: attributeUnique.keyId })
    .from(attributeUnique)
    .where(eq(attributeUnique.tenantId, tenantId));
  const ids = rows.flatMap((r) => (r.keyId === null ? [] : [r.keyId]));
  if (ids.includes(ring.current().id)) return null;
  const missing = ids.filter((id) => ring.byId(id) === undefined);
  return missing.length > 0 ? missing : null;
}

export interface RotationOptions {
  readonly clock?: Clock;
  readonly newEventId?: () => string;
}

/**
 * The rotation job for one tenant: batches of `ROTATION_BATCH`, each its own
 * transaction, walking the stale claims once by cursor. A no-op without
 * `PEOPLE_SECRET_KEYS`, and for good once `rolloutSkipped` has said so.
 *
 * The same job is the backfill for claims written before PEO-082: those have
 * no key id, so they are stale under any ring. A conflict it finds becomes a
 * `people.unique_claim.conflict` event, in the batch's transaction.
 */
export function claimRotation(
  inTenant: InTenantTransaction,
  secretKeys: string | undefined,
  options: RotationOptions = {},
): (tenantId: string) => Promise<void> {
  const keys = keysFrom(secretKeys);
  if (keys.length === 0) return () => Promise.resolve();
  const ring = staticKeyRing(keys);
  const claims = drizzleUniqueClaims(ring);
  const secrets = drizzleSecretStore(ring);
  const reader = drizzlePersonReader();
  const reviews = drizzleIdentifierReviews(ring, secrets);
  const clock = options.clock ?? systemClock;
  const newEventId = options.newEventId ?? uuidv7;
  let halted = false;

  return async (tenantId) => {
    if (halted) return;
    const missing = await inTenant(tenantId, ({ tx }) => rolloutSkipped(tx, tenantId, ring));
    if (missing !== null) {
      halted = true;
      logger.error(
        { tenantId, current: ring.current().id, missing },
        'unique-claim rotation refused: claims are under a key this deployment does not hold and none under the current one; put the old key back after the current one in PEOPLE_SECRET_KEYS and restart',
      );
      return;
    }

    let after: RotationCursor | null = null;
    for (;;) {
      const cursor: RotationCursor | null = after;
      const batch = await inTenant(tenantId, async ({ tx }) => {
        const definitionOf = await definitionsFor(tx, tenantId);
        const result = await claims.rotate(
          tx,
          tenantId,
          async (personId, attributeKey) => {
            const record = await reader.record(tx, tenantId, personId);
            const value =
              record?.values[attributeKey] ??
              (await secrets.reveal(tx, { tenantId, personId, attributeKey }));
            if (value === null) return null;
            const definition = definitionOf(record?.schemaVersion ?? null, attributeKey);
            if (definition) return claimText(definition, value);
            // ponytail: an attribute in no published version at all — a claim
            // only a hand-written row could hold — is keyed as typed, without
            // a country's normalisation.
            return typeof value === 'string' ? value : JSON.stringify(value);
          },
          { after: cursor },
        );
        await publish(
          tx,
          outbox,
          result.conflicts.map((conflict) => conflictEvent(tenantId, conflict, clock, newEventId)),
        );
        return result;
      });
      if (batch.seen < ROTATION_BATCH || batch.last === null) break;
      after = batch.last;
    }

    // Accepted identifier reviews carry a keyed fingerprint of their value
    // (PEO-125): re-keyed here, with the claims, so an acceptance outlives the
    // key it was taken under. Read back as the claims are; shown to nobody.
    await inTenant(tenantId, ({ tx }) =>
      reviews.rekey(tx, tenantId, async (at, personId, attributeKey) => {
        const record = await reader.record(at, tenantId, personId);
        const value =
          record?.values[attributeKey] ??
          (await secrets.reveal(at, { tenantId, personId, attributeKey }));
        return typeof value === 'string' ? normaliseNationalId(value) : null;
      }),
    );
  };
}

/**
 * The definition a claim was made under: from the version the person's record
 * was last written under, else the newest version that has the attribute —
 * which keeps a national identifier's normalisation after the attribute has
 * left the published schema.
 */
async function definitionsFor(
  tx: PostgresJsDatabase,
  tenantId: string,
): Promise<(version: number | null, key: string) => AttributeDefinition | undefined> {
  const versions = await drizzleSchemaVersions().list(tx, tenantId);
  const byVersion = new Map(
    versions.map((v) => [
      v.version,
      new Map(v.document.attributes.map((d) => [d.key as string, d])),
    ]),
  );
  const newest = new Map<string, AttributeDefinition>();
  // Newest first, so the first seen is the newest.
  for (const v of versions) {
    for (const d of v.document.attributes) if (!newest.has(d.key)) newest.set(d.key, d);
  }
  return (version, key) =>
    (version === null ? undefined : byVersion.get(version)?.get(key)) ?? newest.get(key);
}

function conflictEvent(
  tenantId: string,
  conflict: RotationConflict,
  clock: Clock,
  newEventId: () => string,
): PendingEvent {
  return {
    eventId: newEventId(),
    eventName: 'people.unique_claim.conflict',
    eventVersion: 1,
    tenantId: TenantId.parse(tenantId),
    occurredAt: clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'Person', id: conflict.staleClaimBy, version: 1 },
    actor: { kind: 'system', process: 'people-unique-rotation' },
    correlationId: newEventId(),
    causationId: null,
    payload: { ...conflict },
  };
}

/**
 * Whether the driver is reporting a unique violation.
 *
 * Checked on the SQLSTATE rather than on the message, which is localised and
 * names the index — two things that change without anybody thinking they have
 * changed behaviour.
 */
function isUniqueViolation(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const code = (cause as { code?: unknown }).code;
  return code === UNIQUE_VIOLATION;
}

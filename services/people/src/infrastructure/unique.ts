import { createHash, createHmac, hkdfSync } from 'node:crypto';

import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { claimText } from '../application/person/person-access.js';
import { drizzlePersonReader, drizzleSchemaVersions } from './drizzle-person-reader.js';
import { keysFrom, staticKeyRing, type KeyRing, type MasterKey } from './envelope.js';
import { drizzleSecretStore } from './secret-store.js';
import { attributeUnique } from './tables.js';
import type { InTenantTransaction } from './unit-of-work.js';

/**
 * Uniqueness on a tenant-defined attribute, without runtime DDL.
 *
 * A customer who marks "Works council id" unique gets a real unique index
 * enforcing it — the one over `(tenant_id, attribute_key, scope_id,
 * value_hash)` on `people.attribute_unique`. Claiming a value is an INSERT
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

export interface UniqueClaim {
  readonly attributeKey: string;
  /** The legal entity for an entity-scoped rule; the tenant for a tenant-scoped one. */
  readonly scopeId: string;
  readonly value: string;
  readonly personId: string;
}

export interface ClaimConflict {
  readonly attributeKey: string;
  /** Who already holds it. Named because "that is taken" is not an answer HR can act on. */
  readonly heldBy: string;
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
  claim: { readonly attributeKey: string; readonly scopeId: string },
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
   * Re-key up to `limit` claims not yet under the ring's current key, which
   * includes backfilling the ones written before PEO-082 in plaintext.
   * Returns how many it touched; fewer than `limit` means the tenant is done.
   *
   * A hash cannot be re-keyed without its value, so each is read back from
   * where the value lives, and a claim whose value is gone is released.
   * Idempotent: a row already under the current key is never selected.
   */
  rotate(
    tx: PostgresJsDatabase,
    tenantId: string,
    valueOf: ClaimValue,
    limit?: number,
  ): Promise<number>;
}

export function drizzleUniqueClaims(ring: KeyRing): UniqueClaims {
  return {
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
       * One claimant at a time per attribute and scope. The unique index
       * compares hashes under one key, and mid-rotation — or mid-deploy, with
       * replicas holding different current keys — two writers can hash one
       * value under two keys and both pass it. The lock is keyed on the rule,
       * never on the value, so nothing about the value reaches `pg_locks`.
       *
       * ponytail: serialises one attribute's claims per tenant until commit,
       * an import included. Lock only while the ring holds two keys if an
       * import ever makes HR wait.
       */
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attribute_unique:${tenantId}:${request.attributeKey}:${request.scopeId}`}, 0))`,
      );

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
      const legacy = [normalisedValue, createHash('sha256').update(normalisedValue).digest('hex')];

      const held = await tx
        .select({ personId: attributeUnique.personId })
        .from(attributeUnique)
        .where(
          and(
            eq(attributeUnique.tenantId, tenantId),
            eq(attributeUnique.attributeKey, request.attributeKey),
            eq(attributeUnique.scopeId, request.scopeId),
            or(
              inArray(attributeUnique.valueHash, hashes),
              inArray(attributeUnique.normalisedValue, legacy),
            ),
          ),
        )
        .limit(1);

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

    async rotate(tx, tenantId, valueOf, limit = ROTATION_BATCH) {
      const current = ring.current();
      const stale = or(isNull(attributeUnique.keyId), ne(attributeUnique.keyId, current.id));
      const rows = await tx
        .select({
          attributeKey: attributeUnique.attributeKey,
          scopeId: attributeUnique.scopeId,
          personId: attributeUnique.personId,
        })
        .from(attributeUnique)
        .where(and(eq(attributeUnique.tenantId, tenantId), stale))
        .orderBy(attributeUnique.personId, attributeUnique.attributeKey)
        .limit(limit);

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
        await (normalised === ''
          ? tx.delete(attributeUnique).where(where)
          : tx
              .update(attributeUnique)
              .set({
                valueHash: claimHash(current, tenantId, row, normalised),
                keyId: current.id,
                normalisedValue: null,
              })
              .where(where));
      }
      return rows.length;
    },
  };
}

/**
 * The rotation job for one tenant: batches of `ROTATION_BATCH`, each its own
 * transaction, until nothing is stale. A no-op without `PEOPLE_SECRET_KEYS`.
 *
 * The same job is the backfill for claims written before PEO-082: those have
 * no key id, so they are stale under any ring.
 */
export function claimRotation(
  inTenant: InTenantTransaction,
  secretKeys: string | undefined,
): (tenantId: string) => Promise<void> {
  const keys = keysFrom(secretKeys);
  if (keys.length === 0) return () => Promise.resolve();
  const ring = staticKeyRing(keys);
  const claims = drizzleUniqueClaims(ring);
  const secrets = drizzleSecretStore(ring);
  const reader = drizzlePersonReader();
  const schemas = drizzleSchemaVersions();

  return async (tenantId) => {
    for (;;) {
      const touched = await inTenant(tenantId, async ({ tx }) => {
        const version = await schemas.current(tx, tenantId);
        const definitions = new Map(
          (version?.document.attributes ?? []).map((d) => [d.key as string, d]),
        );
        return claims.rotate(tx, tenantId, async (personId, attributeKey) => {
          const record = await reader.record(tx, tenantId, personId);
          const value =
            record?.values[attributeKey] ??
            (await secrets.reveal(tx, { tenantId, personId, attributeKey }));
          if (value === null) return null;
          const definition = definitions.get(attributeKey);
          if (definition) return claimText(definition, value);
          // ponytail: an attribute gone from the published schema is keyed as
          // typed, without its country's normalisation; re-publishing it
          // re-claims on the next write.
          return typeof value === 'string' ? value : JSON.stringify(value);
        });
      });
      if (touched < ROTATION_BATCH) return;
    }
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

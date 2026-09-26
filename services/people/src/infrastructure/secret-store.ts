import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '@kithena/telemetry';

import { keysFrom, open, rewrap, seal, staticKeyRing, type KeyRing } from './envelope.js';
import { personSecret } from './tables.js';
import type { InTenantTransaction } from './unit-of-work.js';

/**
 * Where a bank account, a national identifier and a tax identifier live.
 *
 * Three rules, and they are the reason this is a module of its own rather
 * than a branch inside the person repository:
 *
 *   - **A secret never reaches `people.person.custom`.** JSONB is indexed,
 *     replicated, dumped into fixtures and pasted into tickets. The person row
 *     keeps `last4` and nothing else.
 *   - **A secret never reaches an event.** `ChangedAttribute` refuses to carry
 *     a value for an encrypted attribute at parse time, so there is no
 *     publisher that can do it by mistake.
 *   - **A secret never reaches a log.** Nothing here logs a value, and
 *     `secret-store.integration.test.ts` proves it by handing this a logger
 *     and reading everything it wrote.
 *
 * The store returns `last4` to callers and a plaintext only to the one method
 * named for it, so the ordinary read path cannot produce a value by accident.
 */

export interface StoredSecret {
  readonly attributeKey: string;
  readonly last4: string | null;
  readonly keyId: string;
}

/** What this writes to, when it writes anything. Never a value. */
export interface SecretLogger {
  info(fields: Record<string, unknown>, message: string): void;
}

export interface SecretStore {
  /**
   * Write or replace one secret.
   *
   * Returns what a screen may show. A caller wanting the value back has to ask
   * for it by name, through `reveal`, which is auditable precisely because it
   * is a different call.
   */
  put(
    tx: PostgresJsDatabase,
    where: { tenantId: string; personId: string; attributeKey: string },
    plaintext: string,
  ): Promise<StoredSecret>;

  /** What a profile screen shows: which attributes exist, and their last four. */
  list(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<readonly StoredSecret[]>;

  /**
   * The plaintext, for the two things that legitimately need one: a payroll
   * export the subject consented to, and a subject access request.
   *
   * Named so it reads as an event in a review. Every call site is a decision
   * somebody made.
   */
  reveal(
    tx: PostgresJsDatabase,
    where: { tenantId: string; personId: string; attributeKey: string },
  ): Promise<string | null>;

  /**
   * Every holder's plaintext for one attribute, for an aggregate and nothing
   * else (PEO-078: the nightly pay snapshot). Held in memory by the caller for
   * the length of one computation; logged as a count, never a value.
   */
  revealAll(
    tx: PostgresJsDatabase,
    where: { tenantId: string; attributeKey: string },
  ): Promise<ReadonlyMap<string, string>>;

  /**
   * Re-wrap everything this person holds under the ring's current key.
   *
   * Per person rather than per tenant, so a rotation job is a bounded loop
   * over the directory rather than one statement that locks a table for an
   * hour.
   */
  rotate(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<number>;
}

export function drizzleSecretStore(ring: KeyRing, logger?: SecretLogger): SecretStore {
  return {
    async put(tx, where, plaintext) {
      const sealed = seal(plaintext, ring);

      await tx
        .insert(personSecret)
        .values({
          tenantId: where.tenantId,
          personId: where.personId,
          attributeKey: where.attributeKey,
          ciphertext: sealed.ciphertext,
          keyId: sealed.keyId,
          last4: sealed.last4,
        })
        .onConflictDoUpdate({
          target: [personSecret.tenantId, personSecret.personId, personSecret.attributeKey],
          set: {
            ciphertext: sealed.ciphertext,
            keyId: sealed.keyId,
            last4: sealed.last4,
            updatedAt: new Date(),
          },
        });

      /*
       * The attribute key and the key id. Never the value, never the last
       * four, never the ciphertext.
       *
       * `last4` is display data the subject is shown, and it is still four
       * digits of a bank account sitting in a log aggregator with a different
       * retention policy and a different set of people who can read it.
       */
      logger?.info(
        { attributeKey: where.attributeKey, personId: where.personId, keyId: sealed.keyId },
        'secret stored',
      );

      return { attributeKey: where.attributeKey, last4: sealed.last4, keyId: sealed.keyId };
    },

    async list(tx, tenantId, personId) {
      const rows = await tx
        .select({
          attributeKey: personSecret.attributeKey,
          last4: personSecret.last4,
          keyId: personSecret.keyId,
        })
        .from(personSecret)
        .where(and(eq(personSecret.tenantId, tenantId), eq(personSecret.personId, personId)));

      return rows;
    },

    async reveal(tx, where) {
      const rows = await tx
        .select({ ciphertext: personSecret.ciphertext, keyId: personSecret.keyId })
        .from(personSecret)
        .where(
          and(
            eq(personSecret.tenantId, where.tenantId),
            eq(personSecret.personId, where.personId),
            eq(personSecret.attributeKey, where.attributeKey),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      logger?.info(
        { attributeKey: where.attributeKey, personId: where.personId },
        'secret revealed',
      );

      return open(row, ring);
    },

    async revealAll(tx, where) {
      const rows = await tx
        .select({
          personId: personSecret.personId,
          ciphertext: personSecret.ciphertext,
          keyId: personSecret.keyId,
        })
        .from(personSecret)
        .where(
          and(
            eq(personSecret.tenantId, where.tenantId),
            eq(personSecret.attributeKey, where.attributeKey),
          ),
        );

      logger?.info(
        { attributeKey: where.attributeKey, count: rows.length },
        'secrets revealed for an aggregate',
      );

      return new Map(rows.map((row) => [row.personId, open(row, ring)]));
    },

    async rotate(tx, tenantId, personId) {
      const rows = await tx
        .select({
          attributeKey: personSecret.attributeKey,
          ciphertext: personSecret.ciphertext,
          keyId: personSecret.keyId,
        })
        .from(personSecret)
        .where(and(eq(personSecret.tenantId, tenantId), eq(personSecret.personId, personId)));

      let rewrapped = 0;
      for (const row of rows) {
        const next = rewrap(row, ring);
        if (next.keyId === row.keyId) continue;

        // Awaited in sequence on purpose. A rotation is a background job with
        // nobody waiting, and firing every row at the pool at once is how a
        // maintenance task takes the service down with it.
        // eslint-disable-next-line no-await-in-loop -- see above
        await tx
          .update(personSecret)
          .set({ ciphertext: next.ciphertext, keyId: next.keyId, updatedAt: new Date() })
          .where(
            and(
              eq(personSecret.tenantId, tenantId),
              eq(personSecret.personId, personId),
              eq(personSecret.attributeKey, row.attributeKey),
            ),
          );
        rewrapped += 1;
      }

      return rewrapped;
    },
  };
}

/** People re-wrapped per transaction. Each holds a handful of secrets. */
export const SECRET_ROTATION_BATCH = 200;

/**
 * The re-wrap job for one tenant (PEO-105): every secret not under the ring's
 * current key, moved onto it, so step 4 of the rollout in `.env.example` —
 * dropping the old key — can actually happen.
 *
 * The same shape as PEO-082's claim rotation: the same key ring, batches of
 * people walked once by cursor, each batch its own transaction, hourly, a
 * no-op without `PEOPLE_SECRET_KEYS`. Idempotent — a secret already under the
 * current key is skipped, so a re-run or a second replica re-wraps nothing.
 * Only the data key is re-wrapped; the value is never decrypted, and nothing
 * is logged but counts and key ids.
 *
 * **The rollout-order guard.** A secret under a key this ring does not hold
 * cannot be opened by anybody, and re-wrapping it would throw halfway through
 * a batch. That is a deployment that dropped a key it still needed, so the job
 * refuses, says which key, and stops for good in this process; the service
 * keeps running and every other secret stays readable.
 */
export function secretRotation(
  inTenant: InTenantTransaction,
  secretKeys: string | undefined,
  options: { readonly batch?: number } = {},
): (tenantId: string) => Promise<{ rewrapped: number }> {
  const keys = keysFrom(secretKeys);
  if (keys.length === 0) return () => Promise.resolve({ rewrapped: 0 });
  const ring = staticKeyRing(keys);
  const store = drizzleSecretStore(ring);
  const current = ring.current().id;
  const batch = options.batch ?? SECRET_ROTATION_BATCH;
  let halted = false;

  return async (tenantId) => {
    if (halted) return { rewrapped: 0 };
    const missing = await inTenant(tenantId, async ({ tx }) => {
      const rows = await tx
        .selectDistinct({ keyId: personSecret.keyId })
        .from(personSecret)
        .where(eq(personSecret.tenantId, tenantId));
      // A value waiting for approval is sealed under the same ring (PEO-077).
      const pending = await tx.execute<{ key_id: string }>(sql`
        SELECT DISTINCT key_id FROM people.pending_change
         WHERE tenant_id = ${tenantId}::uuid AND key_id IS NOT NULL`);
      return [...new Set([...rows.map((r) => r.keyId), ...[...pending].map((r) => r.key_id)])].filter(
        (id) => ring.byId(id) === undefined,
      );
    });
    if (missing.length > 0) {
      halted = true;
      logger.error(
        { tenantId, current, missing },
        'secret rotation refused: secrets are under a key this deployment does not hold; put the old key back after the current one in PEOPLE_SECRET_KEYS and restart',
      );
      return { rewrapped: 0 };
    }

    let rewrapped = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const cursor = after;
      // eslint-disable-next-line no-await-in-loop -- one batch, one transaction, at a time
      const done = await inTenant(tenantId, async ({ tx }) => {
        const people = await tx
          .selectDistinct({ personId: personSecret.personId })
          .from(personSecret)
          .where(
            and(
              eq(personSecret.tenantId, tenantId),
              ne(personSecret.keyId, current),
              gt(personSecret.personId, cursor),
            ),
          )
          .orderBy(asc(personSecret.personId))
          .limit(batch);
        for (const { personId } of people) {
          // eslint-disable-next-line no-await-in-loop -- see `rotate`
          rewrapped += await store.rotate(tx, tenantId, personId);
        }
        return people;
      });
      if (done.length < batch) break;
      after = done.at(-1)?.personId ?? after;
    }
    // Values waiting for approval (PEO-077), sealed under the same ring: moved
    // onto the current key the same way, so an old key can go as soon as this
    // run is done. A closed change holds no ciphertext.
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- one batch, one transaction, at a time
      const moved = await inTenant(tenantId, async ({ tx }) => {
        const rows = await tx.execute<{ id: string; ciphertext: Buffer; key_id: string }>(sql`
          SELECT id, ciphertext, key_id FROM people.pending_change
           WHERE tenant_id = ${tenantId}::uuid AND ciphertext IS NOT NULL AND key_id <> ${current}
           ORDER BY id LIMIT ${batch}`);
        for (const row of rows) {
          const next = rewrap(
            { ciphertext: Buffer.from(row.ciphertext).toString('base64'), keyId: row.key_id },
            ring,
          );
          // eslint-disable-next-line no-await-in-loop -- see `rotate`
          await tx.execute(sql`
            UPDATE people.pending_change
               SET ciphertext = ${Buffer.from(next.ciphertext, 'base64')}, key_id = ${next.keyId}
             WHERE tenant_id = ${tenantId}::uuid AND id = ${row.id}::uuid
               AND key_id = ${row.key_id} AND ciphertext IS NOT NULL`);
        }
        return [...rows].length;
      });
      rewrapped += moved;
      if (moved < batch) break;
    }
    if (rewrapped > 0) logger.info({ tenantId, current, rewrapped }, 'secrets re-wrapped');
    return { rewrapped };
  };
}

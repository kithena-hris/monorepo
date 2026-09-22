import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { open, rewrap, seal, type KeyRing } from './envelope.js';
import { personSecret } from './tables.js';

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

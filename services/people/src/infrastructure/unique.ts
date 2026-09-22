import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { attributeUnique } from './tables.js';

/**
 * Uniqueness on a tenant-defined attribute, without runtime DDL.
 *
 * A customer who marks "Works council id" unique gets a real unique index
 * enforcing it — the one over
 * `(tenant_id, attribute_key, scope_id, normalised_value)` that
 * `people.attribute_unique` already carries. Claiming a value is an INSERT
 * into that table in the same transaction as the value itself, so the claim
 * and the value commit together or not at all.
 *
 * **Not `CREATE INDEX` at runtime.** That is the obvious implementation and it
 * is an outage with a settings screen in front of it: DDL against a
 * multi-tenant production table takes a lock every other tenant's reads queue
 * behind, at whatever moment an administrator happened to tick a box. It also
 * cannot be reviewed, cannot be rolled forward with the rest of a release, and
 * leaves a schema that differs per customer.
 *
 * Two checks rather than one — a SELECT first, then the index — and the second
 * is the one that is load bearing. The SELECT produces a good error naming the
 * person who already holds the value; the index is what is true when two
 * imports race, because between the SELECT and the INSERT there is a window
 * and a unique index is the only thing that closes it.
 */

/** Postgres, on a unique violation. */
const UNIQUE_VIOLATION = '23505';

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
 * The stored form of a value, for comparison only.
 *
 * Trimmed and casefolded, so two employee numbers differing by a trailing
 * space are one collision rather than two records. Unicode-normalised first,
 * because `José` typed on a Mac and `José` pasted from a Windows export are
 * different byte sequences for the same name and a unique index compares
 * bytes.
 *
 * The *stored* value keeps whatever the person typed. This is only what the
 * claim is keyed on.
 */
export function normalise(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en');
}

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
}

export function drizzleUniqueClaims(): UniqueClaims {
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

      // A person changing their own value releases the old claim first,
      // otherwise the second value collides with the first — with themselves.
      await this.release(tx, tenantId, {
        personId: request.personId,
        attributeKey: request.attributeKey,
      });

      const held = await tx
        .select({ personId: attributeUnique.personId })
        .from(attributeUnique)
        .where(
          and(
            eq(attributeUnique.tenantId, tenantId),
            eq(attributeUnique.attributeKey, request.attributeKey),
            eq(attributeUnique.scopeId, request.scopeId),
            eq(attributeUnique.normalisedValue, normalisedValue),
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
          normalisedValue,
          personId: request.personId,
        });
      } catch (cause) {
        /*
         * The race the SELECT above cannot close.
         *
         * Two imports, two connections, the same employee number, both past
         * the SELECT before either INSERT lands. The unique index refuses the
         * second, and this turns that into the same refusal the first path
         * produces — because a caller should not have to tell "somebody else
         * holds it" from "somebody else took it while I was asking".
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

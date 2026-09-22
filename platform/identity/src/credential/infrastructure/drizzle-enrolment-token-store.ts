import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { EnrolmentTokenStore } from '../application/enrolment-token-store.js';
import { enrolmentState } from '../domain/enrolment-state.js';
import {
  ENROLMENT_TTL_SECONDS,
  hashEnrolmentToken,
  mintEnrolmentToken,
  type SecondChannel,
} from '../domain/enrolment-token.js';
import { enrolmentToken } from './enrolment-token-table.js';

/**
 * Enrolment tokens in Postgres, not Valkey.
 *
 * A 72-hour token in a cache with no persistence configured — which is what
 * `docker-compose.yml` runs — means every pending enrolment dies with a
 * restart, and the people affected are new hires on their first morning. It is
 * also an auditable event: HR is entitled to see that a link was issued and
 * used, and that record has to outlive a process.
 */
/**
 * The transaction is captured rather than passed per call.
 *
 * Enrolment runs inside one tenant-scoped transaction from start to finish —
 * consuming the token, writing the credential and activating the account all
 * commit together or not at all. Threading the transaction through the port
 * would have put a Drizzle type in an interface the domain side reads.
 */
/**
 * A timestamp column, as a string this module can parse.
 *
 * `String(unknown)` is what a driver change turns into `[object Object]` — and
 * a broken deadline reads as a link that expired rather than as a bug. A `Date`
 * is converted deliberately; anything else is refused loudly by `asInstant`.
 */
function instantOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

/**
 * A `date` column, as the calendar date it is.
 *
 * `employment_start` is a calendar date and not a timestamp — `CLAUDE.md` is
 * explicit that hire, leave and birthday are `date` — but the driver hands one
 * back as either a string or a `Date` depending on how it was written. Taking
 * the first ten characters of an ISO string is the conversion that does not
 * shift the day: `toISOString()` on a midnight-local `Date` west of Greenwich
 * reports the day before.
 */
function calendarDate(value: unknown): string | null {
  if (typeof value === 'string') return value.slice(0, 10);
  if (!(value instanceof Date)) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

export function drizzleEnrolmentTokenStore(
  tx: PostgresJsDatabase,
  tenantId: string,
): EnrolmentTokenStore {
  return {
    async issue(request) {
      // Any live token for this account stops being live. The partial unique
      // index would refuse the insert otherwise, which is the same guarantee
      // arriving as an error rather than as an intention.
      await tx
        .update(enrolmentToken)
        .set({ consumedAt: sql`now()` })
        .where(
          and(eq(enrolmentToken.accountId, request.accountId), isNull(enrolmentToken.consumedAt)),
        );

      const { token, hash } = mintEnrolmentToken();

      // `returning` rather than computing the deadline here. The interval is
      // added by Postgres against Postgres's clock, and the invitation states
      // the deadline to the person reading it — so it has to be the row's, not
      // this process's idea of what the row's probably is.
      const [row] = await tx
        .insert(enrolmentToken)
        .values({
          id: sql`gen_random_uuid()`,
          tenantId,
          accountId: request.accountId,
          tokenHash: hash,
          purpose: request.purpose,
          secondChannel: request.secondChannel,
          expiresAt: sql`now() + make_interval(secs => ${ENROLMENT_TTL_SECONDS})`,
          createdAt: sql`now()`,
          issuedBy: request.issuedBy,
        })
        .returning({ expiresAt: enrolmentToken.expiresAt });

      if (!row) throw new Error('the enrolment token insert returned no row');

      // The token is returned once, in memory, and never read back. The row
      // holds the hash.
      return { token, expiresAt: asInstant(row.expiresAt) };
    },

    /*
     * A read, and only a read.
     *
     * The page asks this before showing its button, so it must not have
     * `consume`'s side effect — a check that spent the link would make opening
     * the page the thing that invalidates it.
     *
     * Joined to the account because the useful answer is about the person, not
     * the row: "you already have a passkey" and "that link was used and did not
     * finish" are the same `consumed_at` and different things to be told.
     * Row-level security scopes this to the tenant, so a token belonging to
     * another customer is not visible to match.
     */
    async inspect(token) {
      const rows = await tx.execute(sql`
        SELECT e.purpose, e.expires_at, e.consumed_at, a.status AS account_status,
               a.given_name, a.family_name, a.preferred_name,
               a.employment_start, a.time_zone
          FROM platform.enrolment_token e
          JOIN platform.account a ON a.id = e.account_id
         WHERE e.token_hash = ${hashEnrolmentToken(token)}
      `);

      const row = [...rows][0];
      if (!row) {
        return {
          state: 'unknown',
          purpose: 'invitation',
          name: null,
          employmentStart: null,
          timeZone: null,
        };
      }

      // The purpose travels alongside the state rather than being collapsed
      // into it. `enrolmentState` folds both into one word, which is what the
      // page needs to decide whether to offer the link at all — and not enough
      // to decide what to *ask* once it does. A recovery link belongs to
      // somebody the registry already knows, so it skips the onboarding form.
      const purpose = typeof row['purpose'] === 'string' ? row['purpose'] : 'invitation';
      /*
       * The name already on the account, or null.
       *
       * What decides whether the onboarding form is shown: an account that has
       * one does not need asking again, and one that does not needs asking
       * whatever kind of link brought them here. Both halves of a legal name or
       * neither — the column constraint says so — so the given name alone is a
       * sufficient test.
       */
      const given = row['given_name'];
      const family = row['family_name'];
      const preferred = row['preferred_name'];

      /*
       * The employment record the form shows back.
       *
       * `employment_start` is a `date` column, so the driver hands back either
       * a string or a `Date` depending on how it was written — normalised here
       * to the calendar date the form renders, rather than at three call sites
       * that would each get it slightly wrong.
       */
      const employmentStart = row['employment_start'];
      const timeZone = row['time_zone'];

      return {
        purpose,
        employmentStart: calendarDate(employmentStart),
        timeZone: typeof timeZone === 'string' ? timeZone : null,
        name:
          typeof given === 'string' && typeof family === 'string'
            ? {
                given,
                family,
                preferred: typeof preferred === 'string' ? preferred : null,
              }
            : null,
        state: enrolmentState(
          {
            purpose,
            expiresAt: asInstant(instantOf(row['expires_at'])),
            consumedAt:
              row['consumed_at'] == null ? null : asInstant(instantOf(row['consumed_at'])),
            accountStatus:
              typeof row['account_status'] === 'string' ? row['account_status'] : '',
          },
          new Date(),
        ),
      };
    },

    async consume(token) {
      /*
       * One statement, and that is the point.
       *
       * `consumed_at IS NULL` inside the UPDATE is what makes this single-use:
       * two requests presenting the same token race for the same row and
       * exactly one matches. Selecting first and updating after would leave a
       * window in which both pass, and the window is where a stolen link gets
       * used twice.
       *
       * Expiry is in the same predicate so an expired token is not consumed on
       * its way to being refused, and the tenant is not — row-level security
       * has already scoped this statement, so a token belonging to another
       * customer is not visible to match.
       */
      const rows = await tx.execute(sql`
        UPDATE platform.enrolment_token
           SET consumed_at = now()
         WHERE token_hash = ${hashEnrolmentToken(token)}
           AND consumed_at IS NULL
           AND expires_at > now()
        RETURNING id, tenant_id, account_id, second_channel, expires_at, consumed_at
      `);

      const row = [...rows][0];
      if (!row) return null;

      return {
        id: String(row['id']),
        tenantId: String(row['tenant_id']),
        accountId: String(row['account_id']),
        secondChannel: String(row['second_channel']) as SecondChannel,
        expiresAt: String(row['expires_at']),
        // Set by the statement above. Reported as it now is, so a caller
        // holding this cannot mistake it for a token still worth using.
        consumedAt: String(row['consumed_at']),
      };
    },
  };
}

/**
 * A `timestamptz` as the driver hands it over, turned into an instant.
 *
 * `@kithena/db-kit`'s `instant` column is `mode: 'string'`, so what comes back
 * is Postgres's own text format — `2026-08-26 22:31:15.112301+00`, with a space
 * and a two-digit offset. That is not ISO 8601, and the difference is not
 * cosmetic: the messaging service validates this field with `z.iso.datetime`
 * and refused every invitation with a 422 until this existed. Nothing in the
 * type system had anything to say, because both shapes are `string`.
 *
 * Parsed as-is rather than repaired first. Substituting a `T` for the space
 * makes it *worse* — `2026-08-26T22:31:15.112301+00` is a malformed ISO string
 * and returns `Invalid Date`, where the original parses correctly through the
 * legacy path. So the input is left alone and the output is `toISOString`,
 * which is ISO 8601 by construction.
 *
 * Converted here rather than by widening the column type, because `instant` is
 * shared by sessions, challenges and the outbox, and changing what all of them
 * return to fix one caller is how an unrelated thing breaks.
 */
export function asInstant(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    // A bug, not a condition. The column is `timestamptz NOT NULL`, so an
    // unreadable value means the driver or the column type changed underneath
    // this, and carrying on would put a broken deadline in front of a person.
    throw new Error(`unreadable timestamp from the database: ${value}`);
  }
  return at.toISOString();
}

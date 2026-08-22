import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { EnrolmentTokenStore } from '../application/enrolment-token-store.js';
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

      await tx.insert(enrolmentToken).values({
        id: sql`gen_random_uuid()`,
        tenantId,
        accountId: request.accountId,
        tokenHash: hash,
        secondChannel: request.secondChannel,
        expiresAt: sql`now() + make_interval(secs => ${ENROLMENT_TTL_SECONDS})`,
        createdAt: sql`now()`,
        issuedBy: request.issuedBy,
      });

      // Returned once, in memory, and never read back. The row holds the hash.
      return token;
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

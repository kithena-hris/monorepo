import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { DigestStore } from '../application/inbox-delivery.js';

/**
 * Updates waiting for the daily digest, over `messaging.inbox_digest`
 * (`migrations/20261010140000_messaging_inbox.sql`): written and taken inside
 * a tenant-scoped transaction, as the delivery log is; which companies have
 * any is the one cross-tenant question, asked of its SECURITY DEFINER function.
 */
export function drizzleDigestStore(
  db: PostgresJsDatabase,
  inTenantTransaction: <T>(
    tenantId: string,
    fn: (tx: PostgresJsDatabase) => Promise<T>,
  ) => Promise<T>,
): DigestStore {
  return {
    async hold(e) {
      await inTenantTransaction(e.tenantId, (tx) =>
        tx.execute(sql`
          INSERT INTO messaging.inbox_digest (tenant_id, to_email, company_name, url)
          VALUES (${e.tenantId}::uuid, ${e.email}, ${e.companyName}, ${e.url})`),
      );
    },

    async tenantsWaiting() {
      const rows = await db.execute<{ tenant_id: string }>(
        sql`SELECT messaging.inbox_digest_tenants() AS tenant_id`,
      );
      return [...rows].map((r) => r.tenant_id);
    },

    async take(tenantId) {
      return inTenantTransaction(tenantId, async (tx) => {
        const rows = await tx.execute<{
          to_email: string;
          company_name: string;
          url: string;
          count: number;
        }>(sql`
          WITH taken AS (
            UPDATE messaging.inbox_digest SET sent_at = now()
             WHERE tenant_id = ${tenantId}::uuid AND sent_at IS NULL
            RETURNING to_email, company_name, url, held_at
          )
          SELECT to_email,
                 (array_agg(company_name ORDER BY held_at DESC))[1] AS company_name,
                 (array_agg(url ORDER BY held_at DESC))[1] AS url,
                 count(*)::int AS count
            FROM taken GROUP BY to_email`);
        // What was sent a week ago is gone: the digest is a count, not a record.
        await tx.execute(sql`
          DELETE FROM messaging.inbox_digest
           WHERE tenant_id = ${tenantId}::uuid AND sent_at < now() - interval '7 days'`);
        return [...rows].map((r) => ({
          tenantId,
          email: r.to_email,
          companyName: r.company_name,
          url: r.url,
          count: r.count,
        }));
      });
    },
  };
}

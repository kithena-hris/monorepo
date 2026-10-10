import { sql } from 'drizzle-orm';

import type { Claim, FailingIntegration, TeamTaskStore } from '../application/inbox/team.js';

/** Team tasks over the webhook tables and `people.inbox_claim`, in the caller's tenant transaction. */

const iso = (v: string | Date): string => new Date(v).toISOString();

export function drizzleTeamTasks(): TeamTaskStore {
  return {
    async failing(tx, tenantId, failures) {
      const rows = await tx.execute<{
        id: string;
        url: string;
        disabled_at: string | Date | null;
        disabled_reason: string | null;
        since: string | Date | null;
        attempts: number | null;
        last_response: number | null;
        waiting: number;
      }>(sql`
        SELECT e.id, e.url, e.disabled_at, e.disabled_reason,
               min(d.first_attempted_at) AS since,
               max(d.attempts) AS attempts,
               (array_agg(d.last_response ORDER BY d.seq DESC))[1] AS last_response,
               count(d.id)::int AS waiting
          FROM people.webhook_endpoint e
          LEFT JOIN people.webhook_delivery d
            ON d.tenant_id = e.tenant_id AND d.endpoint_id = e.id
           AND d.status IN ('pending', 'failed') AND d.attempts >= ${failures}
         WHERE e.tenant_id = ${tenantId}::uuid
         GROUP BY e.id, e.url, e.disabled_at, e.disabled_reason
        HAVING (e.disabled_at IS NOT NULL AND e.disabled_reason IS DISTINCT FROM 'disabled by the tenant')
            OR count(d.id) > 0`);
      return [...rows].map((r): FailingIntegration => ({
        endpointId: r.id,
        url: r.url,
        since: iso(r.since ?? r.disabled_at ?? new Date(0)),
        attempts: r.attempts ?? failures,
        lastResponse: r.last_response,
        disabled: r.disabled_at !== null,
        problem: r.disabled_reason,
        waiting: r.waiting,
      }));
    },

    async claims(tx, tenantId, itemIds) {
      if (itemIds.length === 0) return new Map();
      const rows = await tx.execute<{
        item_id: string;
        taken_by: string;
        taken_at: string | Date;
        note: string | null;
      }>(sql`
        SELECT item_id, taken_by, taken_at, note FROM people.inbox_claim
         WHERE tenant_id = ${tenantId}::uuid AND item_id = ANY(${`{${itemIds.join(',')}}`}::text[])`);
      return new Map(
        [...rows].map((r): [string, Claim] => [
          r.item_id,
          { by: r.taken_by, at: iso(r.taken_at), note: r.note },
        ]),
      );
    },

    async claim(tx, tenantId, itemId, c) {
      await tx.execute(sql`
        INSERT INTO people.inbox_claim (tenant_id, item_id, taken_by, taken_at, note)
        VALUES (${tenantId}::uuid, ${itemId}, ${c.by}::uuid, ${c.at}::timestamptz, ${c.note})
        ON CONFLICT (tenant_id, item_id)
        DO UPDATE SET taken_by = EXCLUDED.taken_by, taken_at = EXCLUDED.taken_at, note = EXCLUDED.note`);
    },
  };
}

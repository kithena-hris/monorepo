import { and, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { webhookDelivery, webhookEndpoint } from './tables.js';

/**
 * A tenant's endpoints as the settings screen lists them (§13.3, screen 9):
 * never a secret, only whether and when one was rotated.
 */
export interface ListedEndpoint {
  readonly id: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly events: readonly string[];
  readonly allowlist: readonly string[];
  readonly alertEmail: string | null;
  readonly retrying: number;
  readonly problem: string | null;
  readonly lastDelivery: string | null;
  readonly secretRotated: string | null;
}

export async function listEndpoints(
  tx: PostgresJsDatabase,
  tenantId: string,
  since: Date,
): Promise<{ endpoints: readonly ListedEndpoint[]; deliveries: number }> {
  const [endpoints, stats, recent] = await Promise.all([
    tx
      .select()
      .from(webhookEndpoint)
      .where(eq(webhookEndpoint.tenantId, tenantId))
      .orderBy(webhookEndpoint.createdAt),
    tx
      .select({
        endpointId: webhookDelivery.endpointId,
        retrying: sql<number>`count(*) FILTER (WHERE ${webhookDelivery.status} = 'pending' AND ${webhookDelivery.attempts} > 0)::int`,
        last: sql<string | null>`max(${webhookDelivery.deliveredAt})::text`,
      })
      .from(webhookDelivery)
      .where(eq(webhookDelivery.tenantId, tenantId))
      .groupBy(webhookDelivery.endpointId),
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(webhookDelivery)
      .where(and(eq(webhookDelivery.tenantId, tenantId), gte(webhookDelivery.deliveredAt, since))),
  ]);
  const byEndpoint = new Map(stats.map((s) => [s.endpointId, s]));
  return {
    deliveries: recent[0]?.n ?? 0,
    endpoints: endpoints.map((e) => {
      const s = byEndpoint.get(e.id);
      return {
        id: e.id,
        url: e.url,
        enabled: e.disabledAt === null,
        events: e.events,
        allowlist: e.allowlist,
        alertEmail: e.alertEmail,
        retrying: s?.retrying ?? 0,
        problem: e.disabledReason,
        lastDelivery: s?.last ?? null,
        secretRotated: e.previousSecretExpiresAt?.toISOString() ?? null,
      };
    }),
  };
}

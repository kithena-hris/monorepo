import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
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

/** One delivery as the log lists it (§13.3, PEO-121): what was sent and how it went, never the body. */
export interface ListedDelivery {
  readonly id: string;
  readonly eventName: string;
  /** pending, delivered, failed or skipped. */
  readonly status: string;
  readonly attempts: number;
  readonly lastResponse: number | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly replayOf: string | null;
}

export const DELIVERY_PAGE = 50;

/** One endpoint's deliveries, newest first, a keyset page at a time by `seq`. */
export async function listDeliveries(
  tx: PostgresJsDatabase,
  tenantId: string,
  endpointId: string,
  after: string | null,
): Promise<{ deliveries: readonly ListedDelivery[]; next: string | null }> {
  const before = after === null || !/^\d{1,18}$/.test(after) ? null : Number(after);
  const rows = await tx
    .select()
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.tenantId, tenantId),
        eq(webhookDelivery.endpointId, endpointId),
        before === null ? undefined : lt(webhookDelivery.seq, before),
      ),
    )
    .orderBy(desc(webhookDelivery.seq))
    .limit(DELIVERY_PAGE);
  return {
    deliveries: rows.map((r) => ({
      id: r.id,
      eventName: r.eventName,
      status: r.status,
      attempts: r.attempts,
      lastResponse: r.lastResponse,
      createdAt: r.createdAt.toISOString(),
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      replayOf: r.replayOf,
    })),
    next: rows.length === DELIVERY_PAGE ? String(rows.at(-1)?.seq ?? '') : null,
  };
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

import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { Segment } from '../domain/segment/segment.js';

/** `people.segment` (PEO-068): named filters, never a list of people. */
export interface SegmentStore {
  /** Every segment in the tenant; who may see which is the caller's to decide. */
  all(tx: PostgresJsDatabase, tenantId: string): Promise<readonly Segment[]>;
  /** False when the owner already has a segment of that name. */
  insert(tx: PostgresJsDatabase, tenantId: string, segment: Segment): Promise<boolean>;
  remove(tx: PostgresJsDatabase, tenantId: string, id: string): Promise<void>;
}

type Row = {
  id: string;
  name: string;
  filter: Record<string, string>;
  owner_account_id: string;
  shared: boolean;
};

export function drizzleSegments(): SegmentStore {
  return {
    async all(tx, tenantId) {
      const found = await tx.execute<Row>(sql`
        SELECT id::text, name, filter, owner_account_id::text, shared
          FROM people.segment WHERE tenant_id = ${tenantId}::uuid`);
      return [...found].map((r) => ({
        id: r.id,
        name: r.name,
        filter: r.filter,
        ownerAccountId: r.owner_account_id,
        shared: r.shared,
      }));
    },
    async insert(tx, tenantId, s) {
      const made = await tx.execute(sql`
        INSERT INTO people.segment (tenant_id, id, name, filter, owner_account_id, shared)
        VALUES (${tenantId}::uuid, ${s.id}::uuid, ${s.name}, ${JSON.stringify(s.filter)}::jsonb,
                ${s.ownerAccountId}::uuid, ${s.shared})
        ON CONFLICT (tenant_id, owner_account_id, lower(name)) DO NOTHING
        RETURNING id`);
      return [...made].length > 0;
    },
    async remove(tx, tenantId, id) {
      await tx.execute(
        sql`DELETE FROM people.segment WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`,
      );
    },
  };
}

/** One tenant's segments in memory, for tests and a standalone boot. */
export function inMemorySegments(): SegmentStore {
  const held = new Map<string, Segment[]>();
  return {
    all: (_tx, tenantId) => Promise.resolve([...(held.get(tenantId) ?? [])]),
    insert(_tx, tenantId, s) {
      const mine = held.get(tenantId) ?? [];
      const taken = mine.some(
        (m) =>
          m.ownerAccountId === s.ownerAccountId && m.name.toLowerCase() === s.name.toLowerCase(),
      );
      if (!taken) held.set(tenantId, [...mine, s]);
      return Promise.resolve(!taken);
    },
    remove(_tx, tenantId, id) {
      held.set(
        tenantId,
        (held.get(tenantId) ?? []).filter((s) => s.id !== id),
      );
      return Promise.resolve();
    },
  };
}

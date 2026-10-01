import { sql } from 'drizzle-orm';

import type {
  SharedSummary,
  SharedSummaryStore,
  SummaryDocument,
} from '../application/screens/what-changed.js';

/**
 * `people.shared_summary`: an Insights summary as it was sent, for its
 * recipient to open signed in (design AI6, MA5). Aggregates and the words the
 * sender chose, never a person's record; kept seven days.
 */
type Row = {
  id: string;
  sender_account_id: string;
  recipient_account_id: string;
  format: 'pdf' | 'email';
  document: SummaryDocument;
  created_at: string;
  expires_at: string;
};

const iso = (at: string | Date): string => new Date(at).toISOString();

export function drizzleSharedSummaries(): SharedSummaryStore {
  return {
    async insert(tx, tenantId, s) {
      await tx.execute(sql`
        INSERT INTO people.shared_summary
          (tenant_id, id, sender_account_id, recipient_account_id, format, document,
           created_at, expires_at)
        VALUES (${tenantId}::uuid, ${s.id}::uuid, ${s.senderAccountId}::uuid,
                ${s.recipientAccountId}::uuid, ${s.format}, ${JSON.stringify(s.document)}::jsonb,
                ${s.createdAt}::timestamptz, ${s.expiresAt}::timestamptz)`);
    },
    async get(tx, tenantId, id) {
      const [row] = await tx.execute<Row>(sql`
        SELECT id::text, sender_account_id::text, recipient_account_id::text, format, document,
               created_at, expires_at
          FROM people.shared_summary
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      return row === undefined
        ? null
        : {
            id: row.id,
            senderAccountId: row.sender_account_id,
            recipientAccountId: row.recipient_account_id,
            format: row.format,
            document: row.document,
            createdAt: iso(row.created_at),
            expiresAt: iso(row.expires_at),
          };
    },
  };
}

/** Sent summaries in memory, for tests and a standalone boot. */
export function inMemorySharedSummaries(): SharedSummaryStore {
  const held = new Map<string, SharedSummary>();
  return {
    insert(_tx, tenantId, s) {
      held.set(`${tenantId}/${s.id}`, s);
      return Promise.resolve();
    },
    get: (_tx, tenantId, id) => Promise.resolve(held.get(`${tenantId}/${id}`) ?? null),
  };
}

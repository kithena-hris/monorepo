import { sql } from 'drizzle-orm';

import type { ApprovalState } from '../../domain/approval/approval.js';
import type { Gap } from '../../domain/export/share.js';
import { after, newestFirst } from '../person/keyset.js';
import { ShareChoice, type ShareRequest, type ShareStore } from './share.js';

/**
 * `people.export_share`, hand-written against
 * `migrations/20261001150000_people_export_share.sql` and
 * `20261004100000_people_export_share_people.sql`. Beside the use case,
 * as the export ledger is: nothing else reads this table.
 */

type Row = {
  tenant_id: string;
  id: string;
  requested_by: string;
  recipient: string;
  reason: string;
  requested_at: Date | string;
  expires_at: Date | string;
  state: ApprovalState;
  decided_by: string | null;
  decided_at: Date | string | null;
  note: string | null;
  choice: unknown;
  gap: Gap;
  export_id: string | null;
  people: number | null;
};

const iso = (v: Date | string) => new Date(v).toISOString();

function fromRow(r: Row): ShareRequest {
  return {
    tenantId: r.tenant_id,
    approval: {
      id: r.id,
      requestedBy: r.requested_by,
      requestedAt: iso(r.requested_at),
      reason: r.reason,
      expiresAt: iso(r.expires_at),
      state: r.state,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at === null ? null : iso(r.decided_at),
      note: r.note,
    },
    recipient: r.recipient,
    // Read back through the schema it was written with: a row is input once more.
    choice: ShareChoice.parse(r.choice),
    gap: r.gap,
    exportId: r.export_id,
    people: r.people,
  };
}

export function drizzleShareStore(): ShareStore {
  return {
    async insert(tx, q) {
      const a = q.approval;
      await tx.execute(sql`
        INSERT INTO people.export_share
               (tenant_id, id, requested_by, recipient, reason, requested_at, expires_at, state,
                choice, gap, people)
        VALUES (${q.tenantId}::uuid, ${a.id}::uuid, ${a.requestedBy}::uuid, ${q.recipient}::uuid,
                ${a.reason}, ${a.requestedAt}::timestamptz, ${a.expiresAt}::timestamptz, ${a.state},
                ${JSON.stringify(q.choice)}::jsonb, ${JSON.stringify(q.gap)}::jsonb, ${q.people})`);
    },

    async find(tx, tenantId, id) {
      const rows = await tx.execute<Row>(sql`
        SELECT * FROM people.export_share WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const row = [...rows][0];
      return row ? fromRow(row) : null;
    },

    async byExport(tx, tenantId, exportId) {
      const rows = await tx.execute<Row>(sql`
        SELECT * FROM people.export_share
         WHERE tenant_id = ${tenantId}::uuid AND export_id = ${exportId}::uuid`);
      const row = [...rows][0];
      return row ? fromRow(row) : null;
    },

    async waiting(tx, tenantId, at, limit, newest) {
      const place = newest?.after ?? null;
      const rows = await tx.execute<Row>(sql`
        SELECT * FROM people.export_share
         WHERE tenant_id = ${tenantId}::uuid AND state = 'pending'
           AND expires_at > ${at}::timestamptz
           AND (${place?.at ?? null}::timestamptz IS NULL
                OR (requested_at, id) < (${place?.at ?? null}::timestamptz, ${place?.id ?? null}::uuid))
         ORDER BY ${newest === undefined ? sql`requested_at, id` : sql`requested_at DESC, id DESC`}
         LIMIT ${limit}`);
      return [...rows].map(fromRow);
    },

    async waitingCount(tx, tenantId, at, notInvolving) {
      const rows = await tx.execute<{ n: number | string }>(sql`
        SELECT count(*) AS n FROM people.export_share
         WHERE tenant_id = ${tenantId}::uuid AND state = 'pending'
           AND expires_at > ${at}::timestamptz
           AND requested_by <> ${notInvolving}::uuid AND recipient <> ${notInvolving}::uuid`);
      return Number([...rows][0]?.n ?? 0);
    },

    async update(tx, prior, next) {
      // Guarded on what moves, so a decision and a send each win once.
      const a = next.approval;
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.export_share
           SET state = ${a.state}, decided_by = ${a.decidedBy}::uuid,
               decided_at = ${a.decidedAt}::timestamptz, note = ${a.note},
               export_id = ${next.exportId}::uuid
         WHERE tenant_id = ${prior.tenantId}::uuid AND id = ${prior.approval.id}::uuid
           AND state = ${prior.approval.state}
           AND export_id IS NOT DISTINCT FROM ${prior.exportId}::uuid
        RETURNING id`);
      return [...rows].length > 0;
    },
  };
}

export function inMemoryShareStore(): ShareStore & { readonly rows: Map<string, ShareRequest> } {
  const rows = new Map<string, ShareRequest>();
  const key = (tenantId: string, id: string) => `${tenantId}/${id}`;
  return {
    rows,
    insert(_tx, q) {
      rows.set(key(q.tenantId, q.approval.id), q);
      return Promise.resolve();
    },
    find: (_tx, tenantId, id) => Promise.resolve(rows.get(key(tenantId, id)) ?? null),
    byExport: (_tx, tenantId, exportId) =>
      Promise.resolve(
        [...rows.values()].find((q) => q.tenantId === tenantId && q.exportId === exportId) ?? null,
      ),
    waiting: (_tx, tenantId, at, limit, newest) => {
      const waiting = [...rows.values()].filter(
        (q) => q.tenantId === tenantId && q.approval.state === 'pending' && q.approval.expiresAt > at,
      );
      const place = (q: ShareRequest) => ({ at: q.approval.requestedAt, id: q.approval.id });
      return Promise.resolve(
        (newest === undefined
          ? waiting.toSorted((a, b) => a.approval.requestedAt.localeCompare(b.approval.requestedAt))
          : waiting
              .filter((q) => after(place(q), newest.after))
              .toSorted((a, b) => newestFirst(place(a), place(b)))
        ).slice(0, limit),
      );
    },
    waitingCount: (_tx, tenantId, at, notInvolving) =>
      Promise.resolve(
        [...rows.values()].filter(
          (q) =>
            q.tenantId === tenantId &&
            q.approval.state === 'pending' &&
            q.approval.expiresAt > at &&
            q.approval.requestedBy !== notInvolving &&
            q.recipient !== notInvolving,
        ).length,
      ),
    update(_tx, prior, next) {
      const k = key(prior.tenantId, prior.approval.id);
      const now = rows.get(k);
      const same =
        now !== undefined &&
        now.approval.state === prior.approval.state &&
        now.exportId === prior.exportId;
      if (same) rows.set(k, next);
      return Promise.resolve(same);
    },
  };
}

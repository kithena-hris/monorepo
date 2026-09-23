import { sql } from 'drizzle-orm';

import type { FullValuesRequest, FullValuesStore } from './full-values.js';

/**
 * `people.full_values_request`, hand-written against
 * `migrations/20260923220000_people_full_values.sql`. Beside the use case, as
 * the export and import ledgers are: nothing else reads this table.
 */

type Row = {
  tenant_id: string;
  id: string;
  requested_by: string;
  requested_at: Date | string;
  reason: string;
  attribute_keys: string[];
  as_of: string | null;
  person_ids: string[] | null;
  filter: string | null;
  expires_at: Date | string;
  state: FullValuesRequest['approval']['state'];
  decided_by: string | null;
  decided_at: Date | string | null;
  note: string | null;
  export_id: string | null;
  file_name: string | null;
  link_issued_at: Date | string | null;
  link_expires_at: Date | string | null;
  downloaded_at: Date | string | null;
};

const iso = (v: Date | string) => new Date(v).toISOString();
const isoOrNull = (v: Date | string | null) => (v === null ? null : iso(v));
const json = (v: readonly string[] | null) => (v === null ? null : JSON.stringify(v));

function fromRow(r: Row): FullValuesRequest {
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
      decidedAt: isoOrNull(r.decided_at),
      note: r.note,
    },
    attributeKeys: r.attribute_keys,
    asOf: r.as_of === null ? null : String(r.as_of).slice(0, 10),
    personIds: r.person_ids,
    filter: r.filter,
    exportId: r.export_id,
    fileName: r.file_name,
    grant:
      r.link_issued_at === null || r.link_expires_at === null
        ? null
        : {
            issuedAt: iso(r.link_issued_at),
            expiresAt: iso(r.link_expires_at),
            usedAt: isoOrNull(r.downloaded_at),
          },
  };
}

export function drizzleFullValuesStore(): FullValuesStore {
  return {
    async insert(tx, q) {
      const a = q.approval;
      await tx.execute(sql`
        INSERT INTO people.full_values_request
               (tenant_id, id, requested_by, requested_at, reason, attribute_keys,
                as_of, person_ids, filter, expires_at, state)
        VALUES (${q.tenantId}::uuid, ${a.id}::uuid, ${a.requestedBy}::uuid,
                ${a.requestedAt}::timestamptz, ${a.reason},
                ARRAY(SELECT jsonb_array_elements_text(${json(q.attributeKeys)}::jsonb)),
                ${q.asOf}::date,
                CASE WHEN ${json(q.personIds)}::jsonb IS NULL THEN NULL
                     ELSE ARRAY(SELECT jsonb_array_elements_text(${json(q.personIds)}::jsonb))::uuid[] END,
                ${q.filter}, ${a.expiresAt}::timestamptz, ${a.state})`);
    },

    async find(tx, tenantId, id) {
      const rows = await tx.execute<Row>(sql`
        SELECT * FROM people.full_values_request
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const row = [...rows][0];
      return row ? fromRow(row) : null;
    },

    async update(tx, prior, next) {
      // Guarded on everything that moves, so a decision, an issue and a
      // download each win once.
      const a = next.approval;
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.full_values_request
           SET state = ${a.state}, decided_by = ${a.decidedBy}::uuid,
               decided_at = ${a.decidedAt}::timestamptz, note = ${a.note},
               export_id = ${next.exportId}::uuid, file_name = ${next.fileName},
               link_issued_at = ${next.grant?.issuedAt ?? null}::timestamptz,
               link_expires_at = ${next.grant?.expiresAt ?? null}::timestamptz,
               downloaded_at = ${next.grant?.usedAt ?? null}::timestamptz
         WHERE tenant_id = ${prior.tenantId}::uuid AND id = ${prior.approval.id}::uuid
           AND state = ${prior.approval.state}
           AND export_id IS NOT DISTINCT FROM ${prior.exportId}::uuid
           AND downloaded_at IS NOT DISTINCT FROM ${prior.grant?.usedAt ?? null}::timestamptz
        RETURNING id`);
      return [...rows].length > 0;
    },
  };
}

export function inMemoryFullValuesStore(): FullValuesStore & {
  readonly rows: Map<string, FullValuesRequest>;
} {
  const rows = new Map<string, FullValuesRequest>();
  const key = (tenantId: string, id: string) => `${tenantId}/${id}`;
  return {
    rows,
    insert(_tx, q) {
      rows.set(key(q.tenantId, q.approval.id), q);
      return Promise.resolve();
    },
    find: (_tx, tenantId, id) => Promise.resolve(rows.get(key(tenantId, id)) ?? null),
    update(_tx, prior, next) {
      const k = key(prior.tenantId, prior.approval.id);
      const now = rows.get(k);
      const same =
        now !== undefined &&
        now.approval.state === prior.approval.state &&
        now.exportId === prior.exportId &&
        (now.grant?.usedAt ?? null) === (prior.grant?.usedAt ?? null);
      if (same) rows.set(k, next);
      return Promise.resolve(same);
    },
  };
}

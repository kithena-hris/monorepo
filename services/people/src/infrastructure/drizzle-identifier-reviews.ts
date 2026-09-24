import { sql } from 'drizzle-orm';
import { outboxTable, publish } from '@kithena/db-kit';

import type { IdentifierReviews } from '../application/person/identifier-review.js';
import type { IdentifierReview } from '../domain/person/identifier-review.js';
import type { SecretStore } from './secret-store.js';

/**
 * `people.identifier_review`, hand-written against
 * `migrations/20260924330000_people_identifier_review.sql` (PEO-125).
 *
 * Every write is a guarded UPDATE or a plain INSERT; nothing here edits the
 * history row a review points at, and nothing reads or writes a value — the
 * one plaintext path is `reveal`, which is the secret store's audited read.
 */

type Row = {
  id: string;
  person_id: string;
  attribute_key: string;
  history_id: string;
  findings: IdentifierReview['findings'] | string;
  state: IdentifierReview['state'];
  created_at: Date | string;
  decided_by: string | null;
  decided_at: Date | string | null;
  note: string | null;
};

const iso = (v: Date | string) => new Date(v).toISOString();

function fromRow(r: Row): IdentifierReview {
  return {
    id: r.id,
    personId: r.person_id,
    attributeKey: r.attribute_key,
    historyId: r.history_id,
    findings:
      typeof r.findings === 'string'
        ? (JSON.parse(r.findings) as IdentifierReview['findings'])
        : r.findings,
    state: r.state,
    createdAt: iso(r.created_at),
    decidedBy: r.decided_by,
    decidedAt: r.decided_at === null ? null : iso(r.decided_at),
    note: r.note,
  };
}

const COLUMNS = sql`id, person_id, attribute_key, history_id, findings, state, created_at,
                    decided_by, decided_at, note`;

export function drizzleIdentifierReviews(secrets: Pick<SecretStore, 'reveal'>): IdentifierReviews {
  return {
    async latest(tx, tenantId, personId, attributeKey) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.identifier_review
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
           AND attribute_key = ${attributeKey}
         ORDER BY created_at DESC, id DESC
         LIMIT 1`);
      const row = [...rows][0];
      return row ? fromRow(row) : null;
    },

    async open(tx, tenantId, personId) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.identifier_review
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
           AND state IN ('pending', 'sent_back')
         ORDER BY created_at`);
      return [...rows].map(fromRow);
    },

    async pending(tx, tenantId, limit) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.identifier_review
         WHERE tenant_id = ${tenantId}::uuid AND state = 'pending'
         ORDER BY created_at, id
         LIMIT ${limit}`);
      return [...rows].map(fromRow);
    },

    async insert(tx, tenantId, r) {
      await tx.execute(sql`
        INSERT INTO people.identifier_review
               (tenant_id, id, person_id, attribute_key, history_id, findings, state, created_at)
        VALUES (${tenantId}::uuid, ${r.id}::uuid, ${r.personId}::uuid, ${r.attributeKey},
                ${r.historyId}::uuid, ${JSON.stringify(r.findings)}::jsonb, ${r.state},
                ${r.createdAt}::timestamptz)`);
    },

    async supersede(tx, tenantId, personId, attributeKey) {
      await tx.execute(sql`
        UPDATE people.identifier_review SET state = 'superseded'
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
           AND attribute_key = ${attributeKey} AND state IN ('pending', 'sent_back')`);
    },

    async decide(tx, tenantId, next) {
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.identifier_review
           SET state = ${next.state}, decided_by = ${next.decidedBy}::uuid,
               decided_at = ${next.decidedAt}::timestamptz, note = ${next.note}
         WHERE tenant_id = ${tenantId}::uuid AND id = ${next.id}::uuid AND state = 'pending'
        RETURNING id`);
      return [...rows].length === 1;
    },

    publish: (tx, events) => publish(tx, outboxTable('people'), events),

    reveal: (tx, where) => secrets.reveal(tx, where),
  };
}

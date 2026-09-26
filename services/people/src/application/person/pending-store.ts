import { sql } from 'drizzle-orm';
import { outboxTable, publish } from '@kithena/db-kit';

import type { Holding, PendingChange, PendingChangeStore } from './pending-changes.js';

/**
 * `people.pending_change`, hand-written against
 * `migrations/20260926180000_people_pending_change.sql`, beside the use case
 * as the full-values store is: nothing else reads this table.
 *
 * A sealed value is sealed here, under the secrets' key ring, and the
 * ciphertext is dropped by the same UPDATE that closes the change.
 */

/** People's outbox, in the caller's transaction. */
export const outboxPendingChanges: Holding['publish'] = (tx, events) =>
  publish(tx, outboxTable('people'), events);

/** The secrets' envelope, as `infrastructure/envelope.ts` provides it over the key ring. */
export interface Sealer {
  seal(plaintext: string): { readonly ciphertext: string; readonly keyId: string };
  open(sealed: { readonly ciphertext: string; readonly keyId: string }): string;
}

type Row = {
  tenant_id: string;
  id: string;
  person_id: string;
  attribute_key: string;
  kind: PendingChange['kind'];
  sealed: boolean;
  value: unknown;
  last4: string | null;
  supersedes: string | null;
  effective_from: string | Date;
  requested_by: string;
  requested_at: Date | string;
  reason: string | null;
  expires_at: Date | string;
  state: PendingChange['approval']['state'];
  decided_by: string | null;
  decided_at: Date | string | null;
  note: string | null;
};

const iso = (v: Date | string) => new Date(v).toISOString();
const day = (v: Date | string) => (typeof v === 'string' ? v.slice(0, 10) : iso(v).slice(0, 10));

const COLUMNS = sql`tenant_id, id, person_id, attribute_key, kind, sealed, value, last4, supersedes,
  effective_from, requested_by, requested_at, reason, expires_at, state, decided_by, decided_at, note`;

function fromRow(r: Row): PendingChange {
  return {
    tenantId: r.tenant_id,
    personId: r.person_id,
    attributeKey: r.attribute_key,
    kind: r.kind,
    approval: {
      id: r.id,
      requestedBy: r.requested_by,
      requestedAt: iso(r.requested_at),
      reason: r.reason ?? '',
      expiresAt: iso(r.expires_at),
      state: r.state,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at === null ? null : iso(r.decided_at),
      note: r.note,
    },
    effectiveFrom: day(r.effective_from),
    supersedes: r.supersedes,
    sealed: r.sealed,
    value: r.sealed ? null : r.value,
    last4: r.last4,
  };
}

export function drizzlePendingChangeStore(sealer: Sealer): PendingChangeStore {
  return {
    async insert(tx, c, plaintext) {
      const a = c.approval;
      const locked = c.sealed && plaintext !== null ? sealer.seal(plaintext) : null;
      await tx.execute(sql`
        INSERT INTO people.pending_change
               (tenant_id, id, person_id, attribute_key, kind, sealed, value, ciphertext, key_id,
                last4, supersedes, effective_from, requested_by, requested_at, reason, expires_at, state)
        VALUES (${c.tenantId}::uuid, ${a.id}::uuid, ${c.personId}::uuid, ${c.attributeKey}, ${c.kind},
                ${c.sealed}, ${c.sealed ? null : JSON.stringify(c.value)}::jsonb,
                ${locked === null ? null : Buffer.from(locked.ciphertext, 'base64')},
                ${locked?.keyId ?? null}, ${c.last4}, ${c.supersedes}::uuid,
                ${c.effectiveFrom}::date, ${a.requestedBy}::uuid, ${a.requestedAt}::timestamptz,
                ${a.reason === '' ? null : a.reason}, ${a.expiresAt}::timestamptz, ${a.state})`);
    },

    async find(tx, tenantId, id) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.pending_change
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const row = [...rows][0];
      return row ? fromRow(row) : null;
    },

    async open(tx, tenantId, where) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.pending_change
         WHERE tenant_id = ${tenantId}::uuid AND state = 'pending'
           AND (${where.personId ?? null}::uuid IS NULL OR person_id = ${where.personId ?? null}::uuid)
           AND (${where.requestedBy ?? null}::uuid IS NULL
                OR requested_by = ${where.requestedBy ?? null}::uuid)
         ORDER BY requested_at, id
         LIMIT ${where.limit}`);
      return [...rows].map(fromRow);
    },

    async unseal(tx, tenantId, id) {
      const rows = await tx.execute<{ ciphertext: Buffer | null; key_id: string | null }>(sql`
        SELECT ciphertext, key_id FROM people.pending_change
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND state = 'pending'`);
      const row = [...rows][0];
      if (!row?.ciphertext || row.key_id === null) return null;
      return sealer.open({
        ciphertext: Buffer.from(row.ciphertext).toString('base64'),
        keyId: row.key_id,
      });
    },

    async close(tx, prior, next) {
      const a = next.approval;
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE people.pending_change
           SET state = ${a.state}, decided_by = ${a.decidedBy}::uuid,
               decided_at = ${a.decidedAt}::timestamptz, note = ${a.note},
               ciphertext = NULL, key_id = NULL
         WHERE tenant_id = ${prior.tenantId}::uuid AND id = ${prior.approval.id}::uuid
           AND state = 'pending'
        RETURNING id`);
      return [...rows].length > 0;
    },
  };
}

/** For tests: the same rules, with the "ciphertext" kept beside the row until it closes. */
export function inMemoryPendingChangeStore(): PendingChangeStore & {
  readonly rows: Map<string, PendingChange>;
  readonly sealed: Map<string, string>;
} {
  const rows = new Map<string, PendingChange>();
  const sealed = new Map<string, string>();
  const key = (tenantId: string, id: string) => `${tenantId}/${id}`;
  return {
    rows,
    sealed,
    insert(_tx, c, plaintext) {
      rows.set(key(c.tenantId, c.approval.id), c);
      if (c.sealed && plaintext !== null) sealed.set(key(c.tenantId, c.approval.id), plaintext);
      return Promise.resolve();
    },
    find: (_tx, tenantId, id) => Promise.resolve(rows.get(key(tenantId, id)) ?? null),
    open: (_tx, tenantId, where) =>
      Promise.resolve(
        [...rows.values()]
          .filter(
            (c) =>
              c.tenantId === tenantId &&
              c.approval.state === 'pending' &&
              (where.personId === undefined || c.personId === where.personId) &&
              (where.requestedBy === undefined || c.approval.requestedBy === where.requestedBy),
          )
          .toSorted((a, b) => (a.approval.requestedAt < b.approval.requestedAt ? -1 : 1))
          .slice(0, where.limit),
      ),
    unseal: (_tx, tenantId, id) =>
      Promise.resolve(
        rows.get(key(tenantId, id))?.approval.state === 'pending'
          ? (sealed.get(key(tenantId, id)) ?? null)
          : null,
      ),
    close(_tx, prior, next) {
      const k = key(prior.tenantId, prior.approval.id);
      if (rows.get(k)?.approval.state !== 'pending') return Promise.resolve(false);
      rows.set(k, next);
      sealed.delete(k);
      return Promise.resolve(true);
    },
  };
}

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';

import type { IdentifierReviews } from '../application/person/identifier-review.js';
import type { IdentifierReview } from '../domain/person/identifier-review.js';
import type { KeyRing, MasterKey } from './envelope.js';
import type { SecretStore } from './secret-store.js';

/**
 * `people.identifier_review`, hand-written against
 * `migrations/20260924330000_people_identifier_review.sql` (PEO-125).
 *
 * Every write is a guarded UPDATE or a plain INSERT; nothing here edits the
 * history row a review points at. **Nothing here decrypts to compare**: a
 * review carries a keyed hash of its value (HMAC-SHA-256 under a key derived
 * per tenant from the master key `key_id` names, as `unique.ts` keys claims),
 * and whether a later write carries the accepted value is a comparison of
 * hashes. The one plaintext path is `reveal`, the secret store's audited read,
 * called only when a reviewer asks to see a value.
 */

/** HKDF `info`: this key is for review fingerprints and nothing else. */
const REVIEW_KEY_INFO = 'kithena/people/identifier-review/v1';

/** The fingerprint of one normalised value, under one master key. */
export function reviewHash(
  master: MasterKey,
  tenantId: string,
  attributeKey: string,
  normalisedValue: string,
): string {
  const key = Buffer.from(
    hkdfSync('sha256', master.key, Buffer.alloc(0), `${REVIEW_KEY_INFO}:${tenantId}`, 32),
  );
  try {
    return createHmac('sha256', key)
      .update(`${attributeKey}\0${normalisedValue}`)
      .digest('base64');
  } finally {
    key.fill(0);
  }
}

type Row = {
  id: string;
  person_id: string;
  attribute_key: string;
  history_id: string;
  value_hash: string;
  key_id: string;
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
    valueHash: r.value_hash,
    keyId: r.key_id,
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

const COLUMNS = sql`id, person_id, attribute_key, history_id, value_hash, key_id, findings, state,
                    created_at, decided_by, decided_at, note`;

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'base64');
  const y = Buffer.from(b, 'base64');
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Where the key rotation reads an accepted value back from, to re-key its fingerprint. */
export type ReviewValue = (
  tx: PostgresJsDatabase,
  personId: string,
  attributeKey: string,
) => Promise<string | null>;

export function drizzleIdentifierReviews(
  ring: KeyRing,
  secrets: Pick<SecretStore, 'reveal'>,
): IdentifierReviews & {
  /**
   * The claim rotation's step for reviews: every accepted review whose value
   * is still the one held, re-fingerprinted under the current key, so an
   * acceptance outlives the key it was taken under. Reads the value back
   * internally, as the claim rotation does; nobody is shown it.
   */
  rekey(tx: PostgresJsDatabase, tenantId: string, valueOf: ReviewValue): Promise<number>;
} {
  const fingerprint = (tenantId: string, attributeKey: string, normalised: string) => {
    const master = ring.current();
    return { valueHash: reviewHash(master, tenantId, attributeKey, normalised), keyId: master.id };
  };

  return {
    fingerprint,

    matches(tenantId, review, normalised) {
      const master = ring.byId(review.keyId);
      return (
        master !== undefined &&
        same(review.valueHash, reviewHash(master, tenantId, review.attributeKey, normalised))
      );
    },

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
               (tenant_id, id, person_id, attribute_key, history_id, value_hash, key_id,
                findings, state, created_at)
        VALUES (${tenantId}::uuid, ${r.id}::uuid, ${r.personId}::uuid, ${r.attributeKey},
                ${r.historyId}::uuid, ${r.valueHash}, ${r.keyId},
                ${JSON.stringify(r.findings)}::jsonb, ${r.state}, ${r.createdAt}::timestamptz)`);
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

    async rekey(tx, tenantId, valueOf) {
      const current = ring.current();
      const stale = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.identifier_review
         WHERE tenant_id = ${tenantId}::uuid AND state = 'accepted' AND key_id <> ${current.id}`);
      let rekeyed = 0;
      for (const review of [...stale].map(fromRow)) {
        const value = await valueOf(tx, review.personId, review.attributeKey);
        const master = ring.byId(review.keyId);
        // Only the value still held and still the one accepted: anything else
        // was replaced since, and its old fingerprint answers nothing new.
        if (value === null || master === undefined) continue;
        if (!same(review.valueHash, reviewHash(master, tenantId, review.attributeKey, value))) {
          continue;
        }
        await tx.execute(sql`
          UPDATE people.identifier_review
             SET value_hash = ${reviewHash(current, tenantId, review.attributeKey, value)},
                 key_id = ${current.id}
           WHERE tenant_id = ${tenantId}::uuid AND id = ${review.id}::uuid`);
        rekeyed += 1;
      }
      return rekeyed;
    },
  };
}

import { sql, type SQL } from 'drizzle-orm';
import { outboxTable, publish } from '@kithena/db-kit';

import { flaggedNow, MARK_DAYS, payReadable } from '../../domain/approval/unusual.js';
import { after, newestFirst } from './keyset.js';
import { reportingLine } from './reporting-line.js';
import type {
  FlaggedWhere,
  Holding,
  PendingChange,
  PendingChangeStore,
} from './pending-changes.js';

/**
 * `payReadable` in SQL: the change's field is pay the decider reads on
 * anybody, or on the people below them (`pay.chain`) or their own reports
 * (`pay.direct`) when the change's person is one — their reporting line
 * walked once per query (`reportingLine`), never per change. The line's
 * arms are left out when the company counts no such pay (`MANAGER_PAY`).
 */
function payReadSql(tenantId: string, where: FlaggedWhere): SQL {
  const { pay } = where;
  const keys = (k: readonly string[]) => sql`c.attribute_key = ANY(${sql.param([...k])}::text[])`;
  const below = (depth: SQL) =>
    sql`c.person_id IN (WITH RECURSIVE ${reportingLine(tenantId, where.decider)}
                        SELECT id FROM below ${depth})`;
  return sql`(${sql.join(
    [
      keys(pay.everyone),
      ...(pay.chain.length === 0 ? [] : [sql`(${keys(pay.chain)} AND ${below(sql``)})`]),
      ...(pay.direct.length === 0
        ? []
        : [sql`(${keys(pay.direct)} AND ${below(sql`WHERE depth = 1`)})`]),
    ],
    sql` OR `,
  )})`;
}

/**
 * `flaggedNow` in SQL, over `c.flag_evidence`: a check switched on, on a pay
 * field only where the decider reads pay (`payReadSql`), not quietened by a
 * recent mark of the same requester's no smaller than it. The in-memory store
 * runs `flaggedNow` itself; `pending-store.integration.test.ts` holds them equal.
 */
function flaggedSql(tenantId: string, where: FlaggedWhere) {
  return sql`jsonb_array_length(c.flag_evidence) > 0 AND EXISTS (
    SELECT 1 FROM jsonb_to_recordset(c.flag_evidence) AS e(code text, magnitude numeric)
     WHERE e.code = ANY(${sql.param([...where.enabled])}::text[])
       AND (e.code NOT IN ('raise', 'band') OR ${payReadSql(tenantId, where)})
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(where.marks)}::jsonb)
                    AS m(code text, "requestedBy" uuid, magnitude numeric, at timestamptz)
          WHERE m.code = e.code AND m."requestedBy" = c.requested_by
            AND m.at >= ${where.at}::timestamptz - make_interval(days => ${MARK_DAYS})
            AND (e.magnitude IS NULL OR m.magnitude IS NULL OR e.magnitude <= m.magnitude)))`;
}

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
  decided_as: PendingChange['decidedAs'];
  /** Read by `decided` alone, so nothing else depends on 20261001170000. */
  flags?: string[] | null;
};

const iso = (v: Date | string) => new Date(v).toISOString();
const day = (v: Date | string) => (typeof v === 'string' ? v.slice(0, 10) : iso(v).slice(0, 10));

const COLUMNS = sql`tenant_id, id, person_id, attribute_key, kind, sealed, value, last4, supersedes,
  effective_from, requested_by, requested_at, reason, expires_at, state, decided_by, decided_at, note,
  decided_as`;

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
    decidedAs: r.decided_as,
    ...(r.flags === null || r.flags === undefined ? {} : { flags: r.flags }),
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
      const place = where.newest?.after ?? null;
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.pending_change c
         WHERE tenant_id = ${tenantId}::uuid AND state = 'pending'
           AND ${where.flagged === undefined ? sql`TRUE` : flaggedSql(tenantId, where.flagged)}
           AND (${where.since ?? null}::timestamptz IS NULL
                OR requested_at >= ${where.since ?? null}::timestamptz)
           AND (${where.personId ?? null}::uuid IS NULL OR person_id = ${where.personId ?? null}::uuid)
           AND (${where.requestedBy ?? null}::uuid IS NULL
                OR requested_by = ${where.requestedBy ?? null}::uuid)
           AND (${place?.at ?? null}::timestamptz IS NULL
                OR (requested_at, id) < (${place?.at ?? null}::timestamptz, ${place?.id ?? null}::uuid))
         ORDER BY ${where.newest === undefined ? sql`requested_at, id` : sql`requested_at DESC, id DESC`}
         LIMIT ${where.limit}`);
      return [...rows].map(fromRow);
    },

    async count(tx, tenantId, where) {
      const rows = await tx.execute<{ n: number | string }>(sql`
        SELECT count(*) AS n FROM people.pending_change c
          JOIN people.person p ON p.tenant_id = c.tenant_id AND p.id = c.person_id
         WHERE c.tenant_id = ${tenantId}::uuid AND c.state = 'pending'
           AND c.expires_at > ${where.at}::timestamptz
           AND c.attribute_key = ANY(${sql.param([...where.keys])}::text[])
           AND (${where.requestedBy ?? null}::uuid IS NULL
                OR c.requested_by = ${where.requestedBy ?? null}::uuid)
           AND (${where.notInvolving ?? null}::uuid IS NULL
                OR (c.requested_by <> ${where.notInvolving ?? null}::uuid
                    AND p.identity_account_id IS DISTINCT FROM ${where.notInvolving ?? null}::uuid))
           AND (${where.subjectAccount ?? null}::uuid IS NULL
                OR p.identity_account_id = ${where.subjectAccount ?? null}::uuid)
           AND ${where.flagged === undefined ? sql`TRUE` : flaggedSql(tenantId, where.flagged)}`);
      return Number([...rows][0]?.n ?? 0);
    },

    async setEvidence(tx, tenantId, id, evidence) {
      await tx.execute(sql`
        UPDATE people.pending_change SET flag_evidence = ${JSON.stringify(evidence)}::jsonb
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND state = 'pending'`);
    },

    async forPerson(tx, tenantId, personId) {
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS} FROM people.pending_change
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
         ORDER BY requested_at, id`);
      return [...rows].map(fromRow);
    },

    async decided(tx, tenantId, where) {
      const mine = where.requestedBy ?? null;
      const before = where.before ?? null;
      const rows = await tx.execute<Row>(sql`
        SELECT ${COLUMNS}, flags FROM people.pending_change
         WHERE tenant_id = ${tenantId}::uuid
           AND (${mine}::uuid IS NULL OR requested_by = ${mine}::uuid)
           AND ((state IN ('approved', 'rejected') AND decided_at >= ${where.since}::timestamptz)
                OR (${mine}::uuid IS NOT NULL AND state = 'withdrawn'
                    AND decided_at >= ${where.since}::timestamptz)
                OR (state IN ('expired', 'pending')
                    AND expires_at >= ${where.since}::timestamptz
                    AND expires_at <= ${where.until}::timestamptz))
           AND (${before?.at ?? null}::timestamptz IS NULL
                OR (COALESCE(decided_at, expires_at), id)
                   < (${before?.at ?? null}::timestamptz, ${before?.id ?? null}::uuid))
         ORDER BY COALESCE(decided_at, expires_at) DESC, id DESC
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
               decided_as = ${next.decidedAs}, ciphertext = NULL, key_id = NULL
         WHERE tenant_id = ${prior.tenantId}::uuid AND id = ${prior.approval.id}::uuid
           AND state = 'pending'
        RETURNING id`);
      return [...rows].length > 0;
    },
  };
}

/** `flaggedSql`, in memory: what `flaggedNow` says of a change's evidence. */
const flaggedIn = (
  c: PendingChange,
  where: FlaggedWhere,
  line: (personId: string) => readonly string[],
): boolean => {
  const above = line(c.personId);
  return (
    flaggedNow(c.flagEvidence ?? [], {
      enabled: new Set(where.enabled),
      marks: where.marks,
      at: where.at,
      requestedBy: c.approval.requestedBy,
      payReadable: payReadable(where.pay, c.attributeKey, {
        direct: above[0] === where.decider,
        chain: above.includes(where.decider),
      }),
    }).length > 0
  );
};

/** For tests: the same rules, with the "ciphertext" kept beside the row until it closes. */
export function inMemoryPendingChangeStore(
  /** Whom each person signs in as, for `count`'s subject; nobody by default. */
  subjects: ReadonlyMap<string, string> = new Map(),
  /** The accounts of a person's managers, nearest first, for Flagged's pay; nobody by default. */
  line: (personId: string) => readonly string[] = () => [],
): PendingChangeStore & {
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
    open: (_tx, tenantId, where) => {
      const listed = [...rows.values()].filter(
        (c) =>
          c.tenantId === tenantId &&
          c.approval.state === 'pending' &&
          (where.personId === undefined || c.personId === where.personId) &&
          (where.requestedBy === undefined || c.approval.requestedBy === where.requestedBy) &&
          (where.since === undefined || c.approval.requestedAt >= where.since) &&
          (where.flagged === undefined || flaggedIn(c, where.flagged, line)),
      );
      const place = (c: PendingChange) => ({ at: c.approval.requestedAt, id: c.approval.id });
      return Promise.resolve(
        (where.newest === undefined
          ? listed.toSorted((a, b) => (a.approval.requestedAt < b.approval.requestedAt ? -1 : 1))
          : listed
              .filter((c) => after(place(c), where.newest?.after ?? null))
              .toSorted((a, b) => newestFirst(place(a), place(b)))
        ).slice(0, where.limit),
      );
    },
    // No people to join here: the subject is whoever `subjects` says signs in as them.
    count: (_tx, tenantId, where) =>
      Promise.resolve(
        [...rows.values()].filter((c) => {
          const subject = subjects.get(c.personId) ?? null;
          return (
            c.tenantId === tenantId &&
            c.approval.state === 'pending' &&
            c.approval.expiresAt > where.at &&
            where.keys.includes(c.attributeKey) &&
            (where.requestedBy === undefined || c.approval.requestedBy === where.requestedBy) &&
            (where.notInvolving === undefined ||
              (c.approval.requestedBy !== where.notInvolving && subject !== where.notInvolving)) &&
            (where.subjectAccount === undefined || subject === where.subjectAccount) &&
            (where.flagged === undefined || flaggedIn(c, where.flagged, line))
          );
        }).length,
      ),
    setEvidence(_tx, tenantId, id, evidence) {
      const k = key(tenantId, id);
      const c = rows.get(k);
      if (c?.approval.state === 'pending') rows.set(k, { ...c, flagEvidence: evidence });
      return Promise.resolve();
    },
    forPerson: (_tx, tenantId, personId) =>
      Promise.resolve(
        [...rows.values()]
          .filter((c) => c.tenantId === tenantId && c.personId === personId)
          .toSorted((a, b) => (a.approval.requestedAt < b.approval.requestedAt ? -1 : 1)),
      ),
    decided: (_tx, tenantId, where) =>
      Promise.resolve(
        [...rows.values()]
          .filter(
            (c) =>
              c.tenantId === tenantId &&
              (where.requestedBy === undefined || c.approval.requestedBy === where.requestedBy) &&
              ((c.approval.state === 'approved' ||
                c.approval.state === 'rejected' ||
                (c.approval.state === 'withdrawn' && where.requestedBy !== undefined)) &&
              c.approval.decidedAt !== null
                ? c.approval.decidedAt >= where.since
                : (c.approval.state === 'expired' || c.approval.state === 'pending') &&
                  c.approval.expiresAt >= where.since &&
                  c.approval.expiresAt <= where.until),
          )
          .filter((c) => {
            if (where.before === undefined) return true;
            const at = Date.parse(c.approval.decidedAt ?? c.approval.expiresAt);
            const then = Date.parse(where.before.at);
            return at < then || (at === then && c.approval.id < where.before.id);
          })
          .toSorted(
            (a, b) =>
              Date.parse(b.approval.decidedAt ?? b.approval.expiresAt) -
                Date.parse(a.approval.decidedAt ?? a.approval.expiresAt) ||
              (a.approval.id < b.approval.id ? 1 : -1),
          )
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

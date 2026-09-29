import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { EntryStore, StoredEntry } from '../application/ports.js';
import type { ActorKind, Area, Entry, EntrySubject } from '../domain/entry.js';
import { SUPPORT_SESSION_HOURS } from '../domain/reading.js';

/**
 * The log, over `audit.entry` (`migrations/20260929160000_audit.sql`).
 *
 * Every statement runs inside `inTenant`, which scopes the transaction to one
 * tenant for row-level security; `svc_audit` does not bypass it.
 */

export type InTenant = <T>(
  tenantId: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>,
) => Promise<T>;

type Row = {
  id: string;
  tenant_id: string;
  source_event_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  module: string;
  area: string;
  action: string;
  detail: string | null;
  actor_kind: string;
  actor_account_id: string | null;
  on_behalf_of: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  subject_label: string | null;
  reason: string | null;
  sign_in_id: string | null;
  sign_in_at: Date | string | null;
  sign_in_reason: string | null;
};

const iso = (v: Date | string): string => new Date(v).toISOString();

/** `%`, `_` and `\` are LIKE's own; a search for "50%" means those characters. */
const likeOf = (text: string): string => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function drizzleEntryStore(inTenant: InTenant): EntryStore {
  return {
    append: (e: Entry) =>
      inTenant(e.tenantId, async (tx) => {
        const rows = await tx.execute(sql`
          INSERT INTO audit.entry
            (tenant_id, source_event_id, occurred_at, recorded_at, module, area, action, detail,
             actor_kind, actor_account_id, on_behalf_of, subject_kind, subject_id, subject_label,
             reason)
          VALUES (${e.tenantId}::uuid, ${e.sourceEventId}::uuid, ${e.occurredAt}::timestamptz,
                  ${e.recordedAt}::timestamptz, ${e.module}, ${e.area}, ${e.action}, ${e.detail},
                  ${e.actor.kind}, ${e.actor.accountId}::uuid, ${e.actor.onBehalfOf}::uuid,
                  ${e.subject?.kind ?? null}, ${e.subject?.id ?? null}, ${e.subject?.label ?? null},
                  ${e.reason})
          ON CONFLICT (tenant_id, source_event_id) DO NOTHING
          RETURNING id`);
        return [...rows].length > 0;
      }),

    page: (tenantId, { filter: f, before, limit }) =>
      inTenant(tenantId, async (tx) => {
        const search = f.search === null || f.search.trim() === '' ? null : likeOf(f.search.trim());
        const rows = await tx.execute<Row>(sql`
          SELECT e.*, s.id AS sign_in_id, s.occurred_at AS sign_in_at, s.reason AS sign_in_reason
            FROM audit.entry e
            LEFT JOIN LATERAL (
              SELECT si.id, si.occurred_at, si.reason
                FROM audit.entry si
               WHERE e.actor_kind = 'support' AND e.area <> 'sign_in'
                 AND si.tenant_id = e.tenant_id AND si.area = 'sign_in'
                 AND si.on_behalf_of = e.on_behalf_of
                 AND si.occurred_at <= e.occurred_at
                 AND si.occurred_at > e.occurred_at - make_interval(hours => ${SUPPORT_SESSION_HOURS})
               ORDER BY si.occurred_at DESC
               LIMIT 1
            ) s ON true
           WHERE e.tenant_id = ${tenantId}::uuid
             AND (${f.areas.join(',')} = '' OR e.area = ANY (string_to_array(${f.areas.join(',')}, ',')))
             AND (${f.actorKind}::text IS NULL OR e.actor_kind = ${f.actorKind})
             AND (${f.actor}::uuid IS NULL OR e.actor_account_id = ${f.actor}::uuid)
             AND (${f.subject}::text IS NULL OR e.subject_id = ${f.subject})
             AND (${f.from}::timestamptz IS NULL OR e.occurred_at >= ${f.from}::timestamptz)
             AND (${f.until}::timestamptz IS NULL OR e.occurred_at < ${f.until}::timestamptz)
             AND (${search}::text IS NULL
                  OR e.action ILIKE ${search} OR e.detail ILIKE ${search}
                  OR e.subject_label ILIKE ${search} OR e.reason ILIKE ${search})
             AND (${before}::uuid IS NULL OR (e.occurred_at, e.id) < (
                   SELECT b.occurred_at, b.id FROM audit.entry b
                    WHERE b.tenant_id = ${tenantId}::uuid AND b.id = ${before}::uuid))
           ORDER BY e.occurred_at DESC, e.id DESC
           LIMIT ${limit}`);
        return [...rows].map(
          (r): StoredEntry => ({
            id: r.id,
            tenantId: r.tenant_id,
            sourceEventId: r.source_event_id,
            occurredAt: iso(r.occurred_at),
            recordedAt: iso(r.recorded_at),
            module: r.module as Entry['module'],
            area: r.area as Area,
            action: r.action,
            detail: r.detail,
            actor: {
              kind: r.actor_kind as ActorKind,
              accountId: r.actor_account_id,
              onBehalfOf: r.on_behalf_of,
            },
            subject:
              r.subject_kind === null
                ? null
                : {
                    kind: r.subject_kind as EntrySubject['kind'],
                    id: r.subject_id,
                    label: r.subject_label,
                  },
            reason: r.reason,
            supportSignIn:
              r.sign_in_id === null || r.sign_in_at === null
                ? null
                : { entryId: r.sign_in_id, at: iso(r.sign_in_at), reason: r.sign_in_reason },
          }),
        );
      }),
  };
}

/** Entries older than the cutoff, for every tenant: retention's one way out. */
export async function purgeBefore(db: PostgresJsDatabase, cutoff: string): Promise<number> {
  const rows = await db.execute<{ gone: string | number }>(
    sql`SELECT audit.purge_before(${cutoff}::timestamptz) AS gone`,
  );
  return Number([...rows][0]?.gone ?? 0);
}

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';
import { ok, type PendingEvent, type Result } from '@kithena/domain-kit';
import { Instant, ViewAsEnded, ViewAsStarted } from '@kithena/contracts';

import type { ViewAsStart } from '../application/start-view-as.js';
import { endedBy, VIEW_AS_AMR, type ViewAsParty } from '../domain/view-as.js';
import { uuidv7 } from '../../shared/uuid.js';

/**
 * `platform.view_as_access` and the view-as session, as
 * `migrations/20260929170000_view_as.sql` defines them. Every function runs in
 * a transaction scoped to the tenant.
 */

const outbox = outboxTable('platform');

const iso = (v: unknown): string => new Date(v instanceof Date ? v : String(v)).toISOString();

async function party(tx: PostgresJsDatabase, accountId: string): Promise<ViewAsParty | null> {
  const [row] = [
    ...(await tx.execute(sql`
      SELECT id, kind, status FROM platform.account WHERE id = ${accountId}::uuid
    `)),
  ];
  return row
    ? { id: String(row['id']), kind: String(row['kind']), status: String(row['status']) }
    : null;
}

/**
 * The session, the record and the event — or, if `check` refuses, none of
 * them. The admin's account is checked for a live view of itself, which only
 * a view-as session trying to start another can produce.
 */
export async function beginViewAs(
  tx: PostgresJsDatabase,
  input: ViewAsStart,
  check: (parties: {
    admin: ViewAsParty | null;
    subject: ViewAsParty | null;
    adminBeingViewed: boolean;
  }) => Result<void>,
): Promise<Result<void>> {
  const [viewed] = [
    ...(await tx.execute(sql`
      SELECT 1 FROM platform.session
       WHERE account_id = ${input.adminAccountId}::uuid
         AND viewed_by IS NOT NULL AND expires_at > ${input.startedAt}::timestamptz
    `)),
  ];
  const allowed = check({
    admin: await party(tx, input.adminAccountId),
    subject: await party(tx, input.subjectAccountId),
    adminBeingViewed: viewed !== undefined,
  });
  if (!allowed.ok) return allowed;

  // No slot: the employee's own devices keep theirs, and nobody is evicted.
  await tx.execute(sql`
    INSERT INTO platform.session
      (id, tenant_id, account_id, slot, started_at, last_seen_at, expires_at, amr,
       viewed_by, reason)
    VALUES (${input.sessionId}::uuid, ${input.tenantId}::uuid, ${input.subjectAccountId}::uuid,
            NULL, ${input.startedAt}::timestamptz, ${input.startedAt}::timestamptz,
            ${input.expiresAt}::timestamptz,
            ARRAY[${VIEW_AS_AMR}]::text[],
            ${input.adminAccountId}::uuid, ${input.reason})
  `);
  await tx.execute(sql`
    INSERT INTO platform.view_as_access
      (id, tenant_id, admin_account_id, subject_account_id, reason, special_category,
       session_id, started_at, expires_at)
    VALUES (${uuidv7()}::uuid, ${input.tenantId}::uuid, ${input.adminAccountId}::uuid,
            ${input.subjectAccountId}::uuid, ${input.reason}, ${input.specialCategory},
            ${input.sessionId}::uuid, ${input.startedAt}::timestamptz,
            ${input.expiresAt}::timestamptz)
  `);
  await publish(tx, outbox, [
    {
      eventId: uuidv7(),
      eventName: ViewAsStarted.name,
      eventVersion: ViewAsStarted.version,
      tenantId: input.tenantId as PendingEvent['tenantId'],
      occurredAt: Instant.parse(input.startedAt),
      effectiveFrom: null,
      aggregate: { type: 'ViewAsSession', id: input.sessionId, version: 1 },
      actor: { kind: 'user', userId: input.adminAccountId },
      correlationId: randomUUID(),
      causationId: null,
      payload: ViewAsStarted.payload.parse({
        sessionId: input.sessionId,
        adminAccountId: input.adminAccountId,
        subjectAccountId: input.subjectAccountId,
        reason: input.reason,
        specialCategory: input.specialCategory,
        expiresAt: input.expiresAt,
      }),
    },
  ]);
  return ok(undefined);
}

/**
 * Close what is still open and raise `identity.view_as.ended` for each, once:
 * the one view-as session `sessionId` names (it is being signed out), or,
 * with `sessionId` null, every one at the company whose thirty minutes have
 * run out. The row lock makes a second closer find it already closed.
 */
export async function closeViewAs(
  tx: PostgresJsDatabase,
  tenantId: string,
  now: Date,
  sessionId: string | null,
): Promise<number> {
  const at = now.toISOString();
  const rows = [
    ...(await tx.execute(sql`
      SELECT id, session_id, admin_account_id, subject_account_id, reason, special_category,
             started_at, expires_at
        FROM platform.view_as_access
       WHERE tenant_id = ${tenantId}::uuid AND ended_at IS NULL
         AND ${sessionId === null ? sql`expires_at <= ${at}::timestamptz` : sql`session_id = ${sessionId}::uuid`}
       FOR UPDATE
    `)),
  ];
  for (const row of rows) {
    const expiresAt = iso(row['expires_at']);
    const by = endedBy(now, expiresAt);
    const endedAt = by === 'time_limit' ? expiresAt : at;
    await tx.execute(sql`
      UPDATE platform.view_as_access SET ended_at = ${endedAt}::timestamptz, ended_by = ${by}
       WHERE id = ${String(row['id'])}::uuid
    `);
    const session = String(row['session_id']);
    const admin = String(row['admin_account_id']);
    await publish(tx, outbox, [
      {
        eventId: uuidv7(),
        eventName: ViewAsEnded.name,
        eventVersion: ViewAsEnded.version,
        tenantId: tenantId as PendingEvent['tenantId'],
        occurredAt: Instant.parse(endedAt),
        effectiveFrom: null,
        aggregate: { type: 'ViewAsSession', id: session, version: 2 },
        actor:
          by === 'admin'
            ? { kind: 'user', userId: admin }
            : { kind: 'system', process: 'identity.view_as.time_limit' },
        correlationId: randomUUID(),
        causationId: null,
        payload: ViewAsEnded.payload.parse({
          sessionId: session,
          adminAccountId: admin,
          subjectAccountId: String(row['subject_account_id']),
          reason: String(row['reason']),
          specialCategory: row['special_category'] === true,
          startedAt: iso(row['started_at']),
          endedBy: by,
        }),
      },
    ]);
  }
  return rows.length;
}

/** Who is viewing through this session, when it is a view-as one. */
export async function viewerOf(
  tx: PostgresJsDatabase,
  sessionId: string,
): Promise<{ adminAccountId: string; expiresAt: string } | null> {
  const [row] = [
    ...(await tx.execute(sql`
      SELECT viewed_by, expires_at FROM platform.session
       WHERE id = ${sessionId}::uuid AND viewed_by IS NOT NULL
    `)),
  ];
  return row ? { adminAccountId: String(row['viewed_by']), expiresAt: iso(row['expires_at']) } : null;
}

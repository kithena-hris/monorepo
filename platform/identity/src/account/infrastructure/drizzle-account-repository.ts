import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';

import type { AccountRepository } from '../application/account-repository.js';
import type { AccountSnapshot, AccountStatus } from '../domain/account.js';
import type { Session } from '../domain/session.js';
import { account, identity, session } from './account-tables.js';

const outbox = outboxTable('platform');

/**
 * How long a session may live at most. Not extended by activity.
 *
 * Here rather than in the domain because it is a deployment policy about
 * storage, not a rule about what an account is. The domain decides who may
 * hold a session; this decides how long a row survives without being looked at.
 */
const ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function drizzleAccountRepository(): AccountRepository {
  return {
    async load(tx, accountId) {
      const rows = await tx.select().from(account).where(eq(account.id, accountId)).limit(1);
      const row = rows[0];
      if (!row) return null;

      const sessions = await tx
        .select()
        .from(session)
        .where(eq(session.accountId, accountId))
        .orderBy(session.slot);

      return {
        id: row.id,
        identityId: row.identityId,
        tenantId: row.tenantId,
        status: row.status as AccountStatus,
        workEmail: row.workEmail,
        employmentStart: row.employmentStart,
        timeZone: row.timeZone,
        sessionLimit: row.sessionLimit,
        sessions: sessions.map((s): Session => ({
          id: s.id,
          slot: s.slot,
          startedAt: s.startedAt,
          lastSeenAt: s.lastSeenAt,
          amr: s.amr,
          // Nullable in the column, never null in the domain: a row written
          // before these columns existed is still a session, and the list
          // screen would rather say "unknown device" than crash.
          device: {
            ip: s.ip ?? 'unknown',
            userAgent: s.userAgent ?? 'unknown',
            aaguid: s.aaguid,
          },
        })),
      } satisfies AccountSnapshot;
    },

    async create(tx, aggregate) {
      const row = aggregate.commissioned;

      // The human first: `platform.account.identity_id` references it, and one
      // human is one identity globally. `DO NOTHING` because a contractor
      // joining their second customer already has one — the identity is the
      // thing that crosses the tenant boundary, and the account is the thing
      // that does not.
      await tx
        .insert(identity)
        .values({ id: row.identityId, createdAt: sql`now()` })
        .onConflictDoNothing();

      await tx.insert(account).values({
        id: aggregate.id,
        tenantId: row.tenantId,
        identityId: row.identityId,
        status: aggregate.status,
        workEmail: row.workEmail,
        timeZone: row.timeZone,
        employmentStart: row.employmentStart,
        sessionLimit: row.sessionLimit,
        version: aggregate.version,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
      });

      // Same transaction as the write, which is the whole mechanism: Debezium
      // tails the WAL, so the event exists if and only if the row committed.
      await publish(tx, outbox, aggregate.drainEvents());
    },

    async save(tx, aggregate) {
      const live = aggregate.liveSessions;
      const liveIds = live.map((s) => s.id);

      // Gone first. A session that was evicted has to release its slot before
      // the session taking that slot is inserted, or the two collide inside our
      // own transaction rather than against a competing one.
      await tx
        .delete(session)
        .where(
          liveIds.length > 0
            ? and(eq(session.accountId, aggregate.id), notInArray(session.id, liveIds))
            : eq(session.accountId, aggregate.id),
        );

      const existing =
        liveIds.length > 0
          ? await tx
              .select({ id: session.id })
              .from(session)
              .where(and(eq(session.accountId, aggregate.id), inArray(session.id, liveIds)))
          : [];
      const known = new Set(existing.map((r) => r.id));

      const added = live.filter((s) => !known.has(s.id));
      if (added.length > 0) {
        // A plain insert. A unique violation here is the slot race, and the
        // caller retries on it — `ON CONFLICT DO NOTHING` would turn a lost
        // race into a login that silently created no session.
        await tx.insert(session).values(
          added.map((s) => ({
            id: s.id,
            tenantId: aggregate.tenantId,
            accountId: aggregate.id,
            slot: s.slot,
            startedAt: s.startedAt,
            lastSeenAt: s.lastSeenAt,
            expiresAt: new Date(Date.parse(s.startedAt) + ABSOLUTE_LIFETIME_MS).toISOString(),
            amr: [...s.amr],
            ip: s.device.ip,
            userAgent: s.device.userAgent,
            aaguid: s.device.aaguid,
          })),
        );
      }

      await tx
        .update(account)
        .set({ status: aggregate.status, version: aggregate.version, updatedAt: sql`now()` })
        .where(eq(account.id, aggregate.id));

      // Same transaction as the write. That is the whole mechanism: Debezium
      // tails the WAL, so an event exists if and only if the write committed.
      await publish(tx, outbox, aggregate.drainEvents());
    },
  };
}

/**
 * The account a verified human holds at this company, if it is usable.
 *
 * Runs inside a tenant-scoped transaction, so row-level security is doing the
 * scoping rather than the `WHERE` clause — pass the wrong tenant and this
 * returns nothing regardless of what the identity id says.
 *
 * `active` only. A provisioned or invited account has not enrolled, a suspended
 * one is being held, and a terminated one is a tombstone; none of them may
 * start a session, and returning one here would move that decision into
 * whichever caller remembered to check.
 */
export async function findActiveAccountForIdentity(
  tx: PostgresJsDatabase,
  identityId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.identityId, identityId), eq(account.status, 'active')))
    .limit(1);

  return rows[0]?.id ?? null;
}

/** Sessions whose absolute lifetime has passed, for the reaper. */
export async function expiredSessionIds(tx: PostgresJsDatabase): Promise<string[]> {
  const rows = await tx
    .select({ id: session.id })
    .from(session)
    .where(sql`${session.expiresAt} < now()`);
  return rows.map((r) => r.id);
}

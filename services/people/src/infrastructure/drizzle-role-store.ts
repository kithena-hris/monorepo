import { and, asc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { publish } from '@kithena/db-kit';

import type { RoleStore } from '../application/roles/roles.js';
import { outbox, person } from './tables.js';

/** `people.role_grant` (20260924270200): who holds a tenant role. */
export const roleGrant = pgSchema('people').table('role_grant', {
  tenantId: uuid('tenant_id').notNull(),
  accountId: uuid('account_id').notNull(),
  role: text('role').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid('granted_by'),
});

/** A person in these states signs in as nobody. */
const GONE = ['terminated', 'discarded', 'merged'];

export function drizzleRoleStore(): RoleStore {
  return {
    async lock(tx, tenantId) {
      // The key the `role_grant_keep_an_admin` trigger takes too.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`people.role_grant:${tenantId}`}, 0))`,
      );
    },

    async holdings(tx, tenantId) {
      const rows = await tx
        .select({ accountId: roleGrant.accountId, role: roleGrant.role })
        .from(roleGrant)
        .where(eq(roleGrant.tenantId, tenantId));
      const held = new Map<string, Set<string>>();
      for (const row of rows) {
        const roles = held.get(row.accountId) ?? new Set<string>();
        roles.add(row.role);
        held.set(row.accountId, roles);
      }
      return held;
    },

    async grant(tx, tenantId, accountId, role, by) {
      await tx
        .insert(roleGrant)
        .values({ tenantId, accountId, role, grantedBy: by })
        .onConflictDoNothing();
    },

    async revoke(tx, tenantId, accountId, role) {
      await tx
        .delete(roleGrant)
        .where(
          and(
            eq(roleGrant.tenantId, tenantId),
            eq(roleGrant.accountId, accountId),
            eq(roleGrant.role, role),
          ),
        );
    },

    async releaseLastAdministrator(tx) {
      // Transaction-local: gone at commit, and read by nothing but the trigger.
      await tx.execute(sql`SELECT set_config('people.release_last_admin', 'on', true)`);
    },

    /**
     * The keyset on `person_role_candidates`
     * (`migrations/20261004123000_people_role_candidates.sql`); a name not yet
     * known sorts as empty, first.
     */
    async candidates(tx, tenantId, where = {}) {
      const family = sql`coalesce(${person.familyName}, '')`;
      const given = sql`coalesce(${person.givenName}, '')`;
      const like =
        where.search == null || where.search === ''
          ? null
          : `%${where.search.replaceAll(/[\\%_]/gu, (c) => `\\${c}`)}%`;
      const query = tx
        .select({
          accountId: person.identityAccountId,
          personId: person.id,
          given: person.givenName,
          family: person.familyName,
          preferred: person.preferredName,
          workEmail: person.workEmail,
        })
        .from(person)
        .where(
          and(
            eq(person.tenantId, tenantId),
            isNotNull(person.identityAccountId),
            notInArray(person.status, GONE),
            where.accounts === undefined
              ? undefined
              : inArray(person.identityAccountId, [...where.accounts]),
            like === null
              ? undefined
              : sql`concat_ws(' ', ${person.givenName}, ${person.preferredName}, ${person.familyName}, ${person.workEmail}) ILIKE ${like}`,
            where.after == null
              ? undefined
              : sql`(${family}, ${given}, ${person.id}) > (
                  SELECT coalesce(p.family_name, ''), coalesce(p.given_name, ''), p.id
                    FROM people.person p
                   WHERE p.tenant_id = ${tenantId}::uuid AND p.id = ${where.after}::uuid)`,
          ),
        )
        .orderBy(asc(family), asc(given), asc(person.id));
      const rows = await (where.limit === undefined ? query : query.limit(where.limit));
      return rows.map((r) => ({
        accountId: r.accountId ?? '',
        personId: r.personId,
        name:
          r.given === null || r.family === null ? null : `${r.preferred ?? r.given} ${r.family}`,
        workEmail: r.workEmail,
      }));
    },

    async publish(tx, events) {
      await publish(tx, outbox, events);
    },
  };
}

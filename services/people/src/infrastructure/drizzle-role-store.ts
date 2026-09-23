import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { publish } from '@kithena/db-kit';

import type { RoleStore } from '../application/roles/roles.js';
import { outbox, person } from './tables.js';

/** `people.role_grant` (20260924230200): who holds a tenant role. */
export const roleGrant = pgSchema('people').table('role_grant', {
  tenantId: uuid('tenant_id').notNull(),
  accountId: uuid('account_id').notNull(),
  role: text('role').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid('granted_by'),
});

/** A person in these states signs in as nobody. */
const GONE = ['terminated', 'discarded'];

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

    async candidates(tx, tenantId) {
      const rows = await tx
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
          ),
        )
        .orderBy(asc(person.familyName), asc(person.givenName), asc(person.id));
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

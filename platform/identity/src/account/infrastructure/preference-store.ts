import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { account } from './account-tables.js';

/**
 * `platform.account_preference`, as `migrations/20260929140000_account_preference.sql`
 * defines it: a person's own preferences, one JSON object per name.
 *
 * Every function runs inside a transaction scoped to the tenant, so row-level
 * security decides what exists: an account of another company is not found.
 */
export const accountPreference = pgSchema('platform').table('account_preference', {
  tenantId: uuid('tenant_id').notNull(),
  accountId: uuid('account_id').notNull(),
  name: text('name').notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** Whether the account is this tenant's. */
export async function hasAccount(tx: PostgresJsDatabase, accountId: string): Promise<boolean> {
  const rows = await tx.select({ id: account.id }).from(account).where(eq(account.id, accountId));
  return rows.length > 0;
}

/** The preference's value, or `null` when the person has never set it. */
export async function readPreference(
  tx: PostgresJsDatabase,
  accountId: string,
  name: string,
): Promise<unknown> {
  const rows = await tx
    .select({ value: accountPreference.value })
    .from(accountPreference)
    .where(and(eq(accountPreference.accountId, accountId), eq(accountPreference.name, name)));
  return rows[0]?.value ?? null;
}

/** Replaces the preference's value; the database stamps when. */
export async function writePreference(
  tx: PostgresJsDatabase,
  tenantId: string,
  accountId: string,
  name: string,
  value: Readonly<Record<string, unknown>>,
): Promise<void> {
  await tx
    .insert(accountPreference)
    .values({ tenantId, accountId, name, value, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [accountPreference.accountId, accountPreference.name],
      set: { value, updatedAt: sql`now()` },
    });
}

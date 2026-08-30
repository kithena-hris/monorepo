import { customType, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { instant } from '@kithena/db-kit';

const platform = pgSchema('platform');

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const enrolmentToken = platform.table('enrolment_token', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  accountId: uuid('account_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  /** `invitation` or `recovery`. Text with a CHECK, not an enum — see the migration. */
  purpose: text('purpose').notNull(),
  secondChannel: text('second_channel').notNull(),
  expiresAt: instant('expires_at').notNull(),
  consumedAt: instant('consumed_at'),
  createdAt: instant('created_at').notNull(),
  issuedBy: uuid('issued_by'),
});

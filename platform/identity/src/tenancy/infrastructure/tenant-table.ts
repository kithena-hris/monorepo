import { boolean, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { instant } from '@kithena/db-kit';

/**
 * `platform.tenant`, as defined by `migrations/20260821120000_tenant_registry.sql`.
 *
 * Deliberately no row-level security on this table, and the migration says why:
 * it is the one table read *before* a tenant is known, so there is no
 * `app.tenant_id` set for a policy to compare against. Everything else in this
 * schema will carry RLS; this is the bootstrap.
 */
const platform = pgSchema('platform');

export const tenant = platform.table('tenant', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull(),
  logoUrl: text('logo_url'),
  accentColor: text('accent_color'),
  brandingPublic: boolean('branding_public').notNull(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
});

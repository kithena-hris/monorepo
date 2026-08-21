import { bigint, boolean, customType, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { instant } from '@kithena/db-kit';

/**
 * `platform.identity` and `platform.credential`, per
 * `migrations/20260821230000_identity.sql`.
 *
 * Neither carries a tenant column, and neither can: one passkey serving three
 * employers is the whole reason identity and account are separate tables. The
 * consequence is that row-level security cannot protect them, so nothing
 * tenant-facing may read them — every tenant-facing read goes through
 * `account`, which is scoped. The migration says the same thing at more length.
 */
const platform = pgSchema('platform');

/**
 * `bytea`, as bytes.
 *
 * Drizzle has no first-class `bytea`, and the obvious `text` would round-trip a
 * public key through a hex string on every assertion. `Uint8Array<ArrayBuffer>`
 * rather than plain `Uint8Array` for the same reason the port narrows it: the
 * default admits `SharedArrayBuffer`, which another thread can mutate while a
 * signature is being checked against it.
 */
const bytea = customType<{ data: Uint8Array<ArrayBuffer>; driverData: Buffer }>({
  dataType: () => 'bytea',
  fromDriver: (value) => new Uint8Array(value),
  toDriver: (value) => Buffer.from(value),
});

export const identity = platform.table('identity', {
  id: uuid('id').primaryKey(),
  createdAt: instant('created_at').notNull(),
});

export const credential = platform.table('credential', {
  id: uuid('id').primaryKey(),
  identityId: uuid('identity_id').notNull(),
  kind: text('kind').notNull(),
  externalId: text('external_id').notNull(),
  provider: text('provider').notNull(),
  publicKey: bytea('public_key'),
  // `bigint` in the column: WebAuthn's counter is 32-bit, but a driver that
  // reads it as a JavaScript number and a column that stores it as one are two
  // different promises, and the one that matters is the column's.
  signCount: bigint('sign_count', { mode: 'number' }).notNull(),
  backedUp: boolean('backed_up').notNull(),
  createdAt: instant('created_at').notNull(),
  lastUsedAt: instant('last_used_at'),
  revokedAt: instant('revoked_at'),
});

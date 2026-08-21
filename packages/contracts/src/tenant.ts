import * as z from 'zod';
import { asPublic, policy } from './classification.js';

/**
 * What may be a tenant's subdomain label.
 *
 * `companyName.app.kithena.com` arrives as a Host header on every request, and
 * the label in front of the suffix is the only thing saying whose data that
 * request may see. That makes these rules part of the isolation boundary rather
 * than a validation nicety.
 *
 * They existed in two places before this file: the `tenant_slug_shape` CHECK
 * constraint in `migrations/20260821120000_tenant_registry.sql`, and again in
 * `apps/web/src/lib/tenant.ts`. A third copy was about to appear in the
 * identity service. Per CLAUDE.md, Zod is the single schema source, so this is
 * that source and the others derive from it.
 *
 * The database keeps its own copy on purpose and that is not duplication of the
 * kind worth removing: the application is one of four transports, and the
 * constraint is the only thing every write passes through. The two must agree,
 * and `tenant.contract.test.ts` is what says so.
 */

/**
 * 3..63 characters because 63 is the DNS label limit, and anything shorter than
 * three is worth keeping back for our own use. No leading or trailing hyphen:
 * both are invalid in a hostname.
 */
const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/**
 * Consecutive hyphens, rejected separately because the reason is different.
 *
 * `xn--` is the punycode prefix, so a label with `--` in the third and fourth
 * position is an internationalised domain name: `xn--pple-43d` renders as
 * `äpple`. Allowing it would let someone register a tenant that displays as
 * another tenant's name. The database says the same thing with `slug !~ '--'`.
 */
const DOUBLE_HYPHEN = /--/;

/**
 * Labels nobody may register. Mirrors `platform.reserved_slug`.
 *
 * Held as data in the database so adding one later is a migration rather than a
 * deploy of every service. Held here as well so the request path can refuse a
 * label before spending a query on it.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'staging',
  'api',
  'admin',
  'static',
  'assets',
  'cdn',
  'mail',
  'smtp',
  'imap',
  'design',
  'storybook',
  'status',
  'docs',
  'support',
  'billing',
  'auth',
  'login',
  'internal',
]);

/**
 * A well-formed label. Says nothing about whether it is available.
 *
 * Shape and availability are separate questions and the database treats them
 * separately too — a CHECK constraint for the first, a trigger for the second.
 * Collapsing them here would mean a reserved label reported as malformed, which
 * is a different thing to tell an operator reading a log.
 */
export const TenantSlug = z
  .string()
  .regex(
    SLUG_SHAPE,
    'must be 3 to 63 characters of a-z, 0-9 and hyphens, not starting or ending in one',
  )
  .refine((slug) => !DOUBLE_HYPHEN.test(slug), 'must not contain consecutive hyphens')
  .brand<'TenantSlug'>()
  .register(policy, asPublic());
export type TenantSlug = z.infer<typeof TenantSlug>;

/** Whether a label is held back, regardless of whether it is well formed. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Well formed *and* available. What a signup may take and a host may resolve. */
export function isRegistrableSlug(slug: string): boolean {
  return TenantSlug.safeParse(slug).success && !isReservedSlug(slug);
}

/**
 * Soft states only. A tenant is never deleted while it holds employment
 * records: a labour inspector can ask for them years after a customer leaves,
 * and retention is a policy decision rather than a DELETE.
 */
export const TenantStatus = z.enum(['active', 'suspended', 'closed']);
export type TenantStatus = z.infer<typeof TenantStatus>;

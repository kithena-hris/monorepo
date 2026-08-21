import { isRegistrableSlug } from '@kithena/contracts';

/**
 * Turning a hostname into a tenant.
 *
 * Every request arrives at `companyName.app.kithena.com` (or
 * `companyName.staging.app.kithena.com`), and the label in front of the suffix
 * is the only thing that says whose data this request is allowed to see. That
 * makes this file part of the isolation boundary rather than a routing detail,
 * so it is written to fail closed at every step: an unparseable host, an
 * unknown label and a reserved label all produce `null`, and `null` is a 404.
 *
 * It deliberately does no I/O and holds no database client. The lookup is
 * injected, so the parsing rules can be tested without a database and the proxy
 * can cache the lookup however it needs to.
 */

/**
 * The slug rules live in `@kithena/contracts`, not here.
 *
 * They were duplicated in this file and in the `tenant_slug_shape` constraint,
 * and a third copy was about to appear in the identity service. Per CLAUDE.md
 * one Zod definition is the source; this file consumes it and re-exports the
 * reserved list so callers do not need to know where it moved to.
 */
export { RESERVED_SLUGS } from '@kithena/contracts';

export interface Tenant {
  readonly id: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended' | 'closed';
}

/** Looks a slug up. Returns null when there is no such tenant. */
export type TenantLookup = (slug: string) => Promise<Tenant | null>;

/**
 * Extracts the tenant label from a Host header.
 *
 * `suffix` is the part after the label — `app.kithena.com` in production,
 * `staging.app.kithena.com` in staging — and comes from configuration rather
 * than being inferred, because inferring it means guessing how many labels
 * belong to the environment and guessing wrong on a hostname somebody
 * controls.
 */
export function slugFromHost(host: string | null, suffix: string): string | null {
  if (!host || !suffix) return null;

  // Drop the port, lower-case, drop a trailing dot. A Host header may carry
  // any of the three and none of them changes which tenant is meant.
  const hostname = host.split(':')[0]?.trim().toLowerCase().replace(/\.$/, '');
  if (!hostname) return null;

  const tail = `.${suffix.trim().toLowerCase().replace(/^\./, '')}`;
  if (!hostname.endsWith(tail)) return null;

  const label = hostname.slice(0, -tail.length);

  // Exactly one label. `a.b.app.kithena.com` is not tenant `a.b`: it is a
  // hostname we did not issue, and treating it as a tenant would let a
  // wildcard certificate holder invent nesting.
  if (!label || label.includes('.')) return null;

  // Shape and availability in one call. Both questions are answered by the
  // contract, so this file cannot drift from the database constraint.
  if (!isRegistrableSlug(label)) return null;

  return label;
}

export interface ResolveResult {
  readonly tenant: Tenant | null;
  /** Why there is no tenant, for logging. Never shown to a caller. */
  readonly reason?: 'no-slug' | 'unknown' | 'suspended' | 'closed';
}

/**
 * Host header to tenant, or nothing.
 *
 * A suspended or closed tenant resolves to nothing as firmly as an unknown one.
 * They are separate reasons so an operator can tell a lapsed customer from a
 * typo in a log, and the same 404 to the request either way — "this account is
 * suspended" on a public hostname tells an outsider that the company is a
 * customer, which is not theirs to learn.
 */
export async function resolveTenant(
  host: string | null,
  suffix: string,
  lookup: TenantLookup,
): Promise<ResolveResult> {
  const slug = slugFromHost(host, suffix);
  if (!slug) return { tenant: null, reason: 'no-slug' };

  const tenant = await lookup(slug);
  if (!tenant) return { tenant: null, reason: 'unknown' };
  if (tenant.status !== 'active') return { tenant: null, reason: tenant.status };

  return { tenant };
}

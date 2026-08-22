import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import { isRegistrableSlug, type TenantStatus } from '@kithena/contracts';

/**
 * A tenant, and the one question this slice exists to answer: may a request
 * carrying this slug be served at all?
 *
 * Pure. No repository, no driver, no clock. Everything here is a rule about
 * what a tenant *is*, which is why it can be tested without a database and
 * why the same rule holds on all four transports.
 */

/**
 * What a login page may say about whose it is.
 *
 * Every field nullable, and null is the answer whenever the company has asked
 * not to be named — see `brandingFor`.
 */
export interface TenantBranding {
  readonly displayName: string | null;
  readonly logoUrl: string | null;
  readonly accentColor: string | null;
}

export interface Tenant {
  readonly id: string;
  readonly slug: string;
  readonly status: TenantStatus;
  readonly branding: TenantBranding;
}

/**
 * Whether this company may be named on a page nobody has authenticated to.
 *
 * `apps/web/src/lib/tenant.ts` refuses to distinguish an unknown company from a
 * suspended one, so that probing labels cannot confirm who is a customer. A
 * logo on the login page publishes exactly that, deliberately, because most
 * customers treat the relationship as a logo on our website and want the
 * branded page.
 *
 * The ones who do not — mid-acquisition, or in a regulated matter — set the
 * flag, and this returns nothing for them. Decided here rather than in the
 * route because it is the same decision on all four transports, and because a
 * route that forgets it leaks silently and looks fine.
 */
export function brandingFor(row: {
  displayName: string;
  logoUrl: string | null;
  accentColor: string | null;
  brandingPublic: boolean;
}): TenantBranding {
  if (!row.brandingPublic) {
    return { displayName: null, logoUrl: null, accentColor: null };
  }

  return {
    displayName: row.displayName,
    logoUrl: row.logoUrl,
    accentColor: row.accentColor,
  };
}

/**
 * Why a slug did not resolve. For logs, never for a caller.
 *
 * All four are the same 404 to whoever asked. They are separate here so an
 * operator can tell a lapsed customer from a typo without the answer being
 * visible to someone probing slugs — `migrations/…tenant_registry.sql` and
 * `apps/web/src/lib/tenant.ts` both make this argument, and it holds equally in
 * the service that owns the registry.
 */
export type UnresolvableReason = 'malformed' | 'unknown' | 'suspended' | 'closed';

export const Unresolvable = (reason: UnresolvableReason): DomainFailure =>
  failure('TENANT_UNRESOLVABLE', 'No such tenant', [reason]);

/**
 * Whether a slug is worth looking up.
 *
 * Separate from resolution because it needs no I/O: a malformed or reserved
 * label cannot be in the registry, so spending a query on it is spending a
 * query to learn something the shape already said.
 */
export function isLookupWorthwhile(slug: string): boolean {
  return isRegistrableSlug(slug);
}

/**
 * A found tenant, admitted or refused.
 *
 * Suspended and closed fail exactly as firmly as unknown. A customer who has
 * lapsed keeps their records — `platform.tenant` deliberately has no delete —
 * but keeping the records is not the same as serving the requests, and the two
 * get conflated the moment this returns anything but a failure.
 */
export function admit(tenant: Tenant): Result<Tenant> {
  switch (tenant.status) {
    case 'active':
      return ok(tenant);
    case 'suspended':
      return err(Unresolvable('suspended'));
    case 'closed':
      return err(Unresolvable('closed'));
  }
}

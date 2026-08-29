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
  /** The larger picture, filling half the sign-in page. */
  readonly coverImageUrl: string | null;
  /**
   * The preset the company chose, as an id rather than a colour.
   *
   * The app turns it into a whole ramp — `THEME_PRESETS` has the hue and Reach's
   * `brandRamp` builds every accent token from it, in both colour schemes. That
   * is why an id travels and not a value: a colour would theme the one token
   * somebody remembered to set, and would pin the company to whatever the
   * preset happened to be on the afternoon they signed up.
   */
  readonly themeId: string | null;
  /** @deprecated Superseded by `themeId`. Retained until nothing reads it. */
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
  coverImageUrl?: string | null;
  themeId?: string | null;
  accentColor: string | null;
  brandingPublic: boolean;
}): TenantBranding {
  if (!row.brandingPublic) {
    return {
      displayName: null,
      logoUrl: null,
      coverImageUrl: null,
      // The theme is not withheld, and it is the one field that is not.
      //
      // The flag hides *who the customer is* — the name, the mark, the
      // photograph of their building. An accent colour identifies nobody: six
      // presets across every customer, and the company that picked Teal is not
      // discoverable from a teal button. Withholding it would drop a
      // mid-acquisition customer back to the default indigo, which is a visible
      // change to their own staff for no privacy gained.
      themeId: row.themeId ?? null,
      accentColor: null,
    };
  }

  return {
    displayName: row.displayName,
    logoUrl: row.logoUrl,
    // The cover is branding like the rest of it, so it lives or dies by the
    // same flag. A company that asked not to be named but whose photograph
    // still filled half the page would have been told the flag did something
    // it did not.
    coverImageUrl: row.coverImageUrl ?? null,
    themeId: row.themeId ?? null,
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

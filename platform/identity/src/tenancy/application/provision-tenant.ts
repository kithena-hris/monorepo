import { ok, type Result } from '@kithena/domain-kit';
import type { PostalAddress } from '@kithena/contracts';

import { checkProvisionable, type ProvisionRequest } from '../domain/provision.js';

/**
 * Creating a customer, and inviting the people who will run it.
 *
 * One transaction from end to end: the tenant, its administrators and their
 * links commit together or not at all. Half of it is a company that exists with
 * nobody able to reach it, which looks like a working signup right up until
 * somebody tries to log in.
 *
 * **Nothing here enrols a credential.** The operator creating the customer
 * names people and each is sent their own single-use link; whoever enrols does
 * so themselves. If one person could do both, a single compromised back-office
 * laptop would be a silent, complete takeover of a new customer — and in the
 * logs it would look exactly like normal onboarding.
 */
export interface ProvisionedTenant {
  readonly tenantId: string;
  readonly slug: string;
  /** One per administrator. Shown once and never retrievable. */
  readonly invitations: readonly { readonly email: string; readonly token: string }[];
}

/**
 * The writes, as one unit of work.
 *
 * These are methods on a scope rather than four independent dependencies, and
 * that is the whole point: the previous shape handed out four closures over a
 * connection *pool*, so `db.transaction(() => fn())` opened a transaction whose
 * handle nobody used and every statement inside it ran on a different
 * connection. It was four transactions wearing one comment.
 *
 * That is not a tidiness problem. `enterTenant` sets `app.tenant_id` with
 * `set_config(..., true)`, which is scoped to *its* transaction — so on a
 * separate connection the setting was gone before the next statement, and the
 * account insert was refused by row-level security with 42501. A shape that
 * cannot express "these run together" is a shape where this recurs.
 */
export interface ProvisionScope {
  /** Writes the tenant. Expected to throw on a duplicate label. */
  createTenant: (input: {
    slug: string;
    displayName: string;
    themeId: string;
    logoUrl: string | null;
    coverImageUrl: string | null;
    address: PostalAddress;
  }) => Promise<string>;
  /**
   * Sets the row-level-security context for the rest of the transaction.
   *
   * Separate from opening the transaction because the tenant id does not exist
   * until `createTenant` has run. `platform.tenant` carries no RLS — it is read
   * before a tenant is known — which is why that insert succeeds without this
   * and everything after it does not.
   */
  enterTenant: (tenantId: string) => Promise<void>;
  /** Creates an invited account and returns its id. */
  inviteAdmin: (tenantId: string, email: string) => Promise<string>;
  /** Issues the single-use link. Returns it once, in memory. */
  issueEnrolment: (tenantId: string, accountId: string) => Promise<string>;
}

export interface ProvisionTenantDeps {
  readonly inTransaction: <T>(fn: (scope: ProvisionScope) => Promise<T>) => Promise<T>;
}

export type ProvisionTenant = (request: ProvisionRequest) => Promise<Result<ProvisionedTenant>>;

export function provisionTenant(deps: ProvisionTenantDeps): ProvisionTenant {
  return async (request) => {
    // Everything knowable without a query, first. Availability of the label is
    // not checked here on purpose: that is a unique index, and asking the
    // database before writing would be a check-then-act with a gap in it.
    const checked = checkProvisionable(request);
    if (!checked.ok) return checked;

    return deps.inTransaction(async (scope) => {
      const tenantId = await scope.createTenant({
        slug: checked.value.slug,
        displayName: checked.value.displayName.trim(),
        themeId: checked.value.themeId,
        logoUrl: checked.value.logoUrl,
        coverImageUrl: checked.value.coverImageUrl,
        address: checked.value.address,
      });

      // Before any row scoped to this tenant.
      await scope.enterTenant(tenantId);

      const invitations: { email: string; token: string }[] = [];
      for (const email of checked.value.admins) {
        const accountId = await scope.inviteAdmin(tenantId, email);
        invitations.push({ email, token: await scope.issueEnrolment(tenantId, accountId) });
      }

      return ok({ tenantId, slug: checked.value.slug, invitations });
    });
  };
}

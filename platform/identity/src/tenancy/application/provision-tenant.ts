import { ok, type Result } from '@kithena/domain-kit';

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

export interface ProvisionTenantDeps {
  /** Writes the tenant. Expected to throw on a duplicate label. */
  readonly createTenant: (input: {
    slug: string;
    displayName: string;
    accentColor: string | null;
  }) => Promise<string>;
  /** Creates an invited account and returns its id. */
  readonly inviteAdmin: (tenantId: string, email: string) => Promise<string>;
  /** Issues the single-use link. Returns it once, in memory. */
  readonly issueEnrolment: (tenantId: string, accountId: string) => Promise<string>;
  readonly inTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
}

export type ProvisionTenant = (request: ProvisionRequest) => Promise<Result<ProvisionedTenant>>;

export function provisionTenant(deps: ProvisionTenantDeps): ProvisionTenant {
  return async (request) => {
    // Everything knowable without a query, first. Availability of the label is
    // not checked here on purpose: that is a unique index, and asking the
    // database before writing would be a check-then-act with a gap in it.
    const checked = checkProvisionable(request);
    if (!checked.ok) return checked;

    return deps.inTransaction(async () => {
      const tenantId = await deps.createTenant({
        slug: checked.value.slug,
        displayName: checked.value.displayName.trim(),
        accentColor: checked.value.accentColor,
      });

      const invitations: { email: string; token: string }[] = [];
      for (const email of checked.value.admins) {
        const accountId = await deps.inviteAdmin(tenantId, email);
        invitations.push({ email, token: await deps.issueEnrolment(tenantId, accountId) });
      }

      return ok({ tenantId, slug: checked.value.slug, invitations });
    });
  };
}

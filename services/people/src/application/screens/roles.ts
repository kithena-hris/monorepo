import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { TenantRole } from '../../domain/access/roles.js';
import type { Asking } from '../person/person-access.js';
import { run, type PeopleService } from '../person/service.js';

/**
 * The roles settings screen (PEO-112): everybody who signs in here, what each
 * holds, and whether the viewer may change it. Built from `TenantRoles.list`,
 * which is HR's and People administrators' to read; the writes go through
 * `/v1/roles/grants` and `/v1/roles/revocations`, where the rules are.
 *
 * `apps/web/people/src/settings/roles.tsx` has the reading side, named the same.
 */

export interface RolesViewPerson {
  readonly accountId: string;
  /** Null for an account People has no person for yet. */
  readonly personId: string | null;
  readonly name: string | null;
  readonly workEmail: string | null;
  readonly roles: readonly TenantRole[];
}

export interface RolesView {
  readonly viewerAccountId: string;
  /** Only a `people_admin` (or Kithena support) grants and revokes; HR reads. */
  readonly canManage: boolean;
  /** The table: a page of everybody who signs in, by name, or those the search finds. */
  readonly people: readonly RolesViewPerson[];
  /** The next page's place (the last person's id); null on the last. */
  readonly next: string | null;
  /** Everybody holding a role, named where People has their person: the role cards'. */
  readonly holders: readonly RolesViewPerson[];
}

/** The table, a keyset page at a time as it scrolls. */
export const ROLES_PAGE = 100;

export async function rolesView(
  deps: { readonly service: PeopleService },
  asking: Asking,
  page: { readonly search?: string | null; readonly after?: string | null } = {},
): Promise<Result<RolesView>> {
  const { roles } = deps.service;
  if (!roles) return err(failure('UNAVAILABLE', 'Roles are not configured'));
  const search = page.search?.trim() || null;
  return run(deps.service, asking.tenantId, async (tx) => {
    const listed = await roles.list(tx, asking, {
      search,
      after: page.after ?? null,
      limit: ROLES_PAGE + 1,
    });
    if (!listed.ok) return listed;
    const { holders, candidates, named } = listed.value;
    const held = new Map(holders.map((h) => [h.accountId, h.roles]));
    const shown = candidates.slice(0, ROLES_PAGE);
    const next = candidates.length > ROLES_PAGE ? (shown.at(-1)?.personId ?? null) : null;
    const people: RolesViewPerson[] = shown.map((c) => ({
      ...c,
      roles: held.get(c.accountId) ?? [],
    }));
    const byAccount = new Map(named.map((c) => [c.accountId, c]));
    const holderViews: RolesViewPerson[] = holders.map((h) => {
      const c = byAccount.get(h.accountId);
      return {
        accountId: h.accountId,
        personId: c?.personId ?? null,
        name: c?.name ?? null,
        workEmail: c?.workEmail ?? null,
        roles: h.roles,
      };
    });
    // A holder with no person yet — named in the back office before their
    // account reached People — is still listed, at the end of the whole
    // list, so nothing is held unseen.
    if (next === null && search === null) {
      people.push(...holderViews.filter((h) => h.personId === null));
    }
    return ok({
      viewerAccountId: asking.viewer.accountId,
      canManage:
        asking.viewer.support !== undefined ||
        held.get(asking.viewer.accountId)?.includes('people_admin') === true,
      people,
      next,
      holders: holderViews,
    });
  });
}

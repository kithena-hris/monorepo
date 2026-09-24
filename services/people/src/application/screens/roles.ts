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
  /** Only a `people_admin` grants and revokes; HR reads. */
  readonly canManage: boolean;
  readonly people: readonly RolesViewPerson[];
}

export async function rolesView(
  deps: { readonly service: PeopleService },
  asking: Asking,
): Promise<Result<RolesView>> {
  const { roles } = deps.service;
  if (!roles) return err(failure('UNAVAILABLE', 'Roles are not configured'));
  return run(deps.service, asking.tenantId, async (tx) => {
    const listed = await roles.list(tx, asking);
    if (!listed.ok) return listed;
    const { holders, candidates } = listed.value;
    const held = new Map(holders.map((h) => [h.accountId, h.roles]));
    const people: RolesViewPerson[] = candidates.map((c) => ({
      ...c,
      roles: held.get(c.accountId) ?? [],
    }));
    // A holder with no person yet — named in the back office before their
    // account reached People — is still listed, so nothing is held unseen.
    for (const holder of holders) {
      if (!candidates.some((c) => c.accountId === holder.accountId)) {
        people.push({
          accountId: holder.accountId,
          personId: null,
          name: null,
          workEmail: null,
          roles: holder.roles,
        });
      }
    }
    return ok({
      viewerAccountId: asking.viewer.accountId,
      canManage: held.get(asking.viewer.accountId)?.includes('people_admin') === true,
      people,
    });
  });
}

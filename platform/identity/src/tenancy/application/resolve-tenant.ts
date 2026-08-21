import { err, type Result } from '@kithena/domain-kit';

import { admit, isLookupWorthwhile, Unresolvable, type Tenant } from '../domain/tenant.js';
import type { TenantRepository } from './tenant-repository.js';

/**
 * Slug in, tenant out, or nothing.
 *
 * This is the first thing that runs on every request in the product, before a
 * user is known and before row-level security has a tenant to scope by. It is
 * written to fail closed at every step, and the order of the steps is part of
 * that: the shape check comes first because it needs no I/O, which means an
 * unregistrable label costs nothing and cannot be used to make the registry
 * answer questions about itself.
 */
export interface ResolveTenantDeps {
  readonly tenants: TenantRepository;
}

export type ResolveTenant = (slug: string) => Promise<Result<Tenant>>;

export function resolveTenant({ tenants }: ResolveTenantDeps): ResolveTenant {
  return async (slug) => {
    if (!isLookupWorthwhile(slug)) return err(Unresolvable('malformed'));

    const found = await tenants.bySlug(slug);
    if (!found) return err(Unresolvable('unknown'));

    return admit(found);
  };
}

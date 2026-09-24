import { err, ok, type Result } from '@kithena/domain-kit';
import type { ModuleEntitlement } from '@kithena/contracts';

import { checkEntitlements } from '../domain/entitlements.js';
import { TenantUnknown } from './amend-tenant.js';

/**
 * The back office records which modules a company bought (PEO-114).
 *
 * `write` stores the list and raises `identity.tenant.entitlements_changed`
 * in one transaction, and only when the list changed: saving the same ticks
 * twice tells no module anything. It reports whether there was a company to
 * write to, rather than a read before it, for the reason `amendTenant` gives.
 */
export interface SetEntitlementsDeps {
  readonly write: (
    tenantId: string,
    entitlements: readonly ModuleEntitlement[],
  ) => Promise<'changed' | 'unchanged' | 'unknown'>;
}

export type SetEntitlements = (
  tenantId: string,
  asked: readonly string[],
) => Promise<Result<{ entitlements: ModuleEntitlement[]; changed: boolean }>>;

export function setEntitlements({ write }: SetEntitlementsDeps): SetEntitlements {
  return async (tenantId, asked) => {
    const checked = checkEntitlements(asked);
    if (!checked.ok) return checked;
    const written = await write(tenantId, checked.value);
    if (written === 'unknown') return err(TenantUnknown);
    return ok({ entitlements: checked.value, changed: written === 'changed' });
  };
}

import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { ADMINISTERED_MODULES, type ModuleEntitlement } from '@kithena/contracts';

import { checkEntitlements } from '../domain/entitlements.js';
import {
  AdministratorUnusable,
  ModuleNotEnabled,
  administratorsToName,
  mayAdminister,
  type NamedAdministrator,
} from '../domain/administrators.js';
import { TenantUnknown } from './amend-tenant.js';

/**
 * The modules a company bought (PEO-114), and who first administers each
 * (PEO-112), changed by the back office.
 *
 * Everything is checked before anything is written, so a refusal leaves the
 * company as it was. The writes are the scope's, in one transaction: the list
 * and `identity.tenant.entitlements_changed` only when the list moved, and
 * `identity.tenant.administrator_named` for each administrator named.
 */
export interface ModulesScope {
  /** The company's lists, or null for a company that does not exist. */
  modules(): Promise<{
    readonly recorded: readonly ModuleEntitlement[] | null;
    readonly effective: readonly ModuleEntitlement[];
  } | null>;
  /** An account's status at this company, or null when it has none there. */
  accountStatus(accountId: string): Promise<string | null>;
  save(entitlements: readonly ModuleEntitlement[]): Promise<void>;
  name(administrator: NamedAdministrator, namedBy: string | null): Promise<void>;
}

export interface ModulesDeps {
  readonly inTenant: <T>(tenantId: string, fn: (scope: ModulesScope) => Promise<T>) => Promise<T>;
}

export type SetEntitlements = (
  tenantId: string,
  asked: {
    readonly entitlements: readonly string[];
    /** Module → account, for each administered module switched on. */
    readonly administrators?: Readonly<Record<string, string>>;
    /** The back-office operator making the change. */
    readonly namedBy?: string | null;
  },
) => Promise<
  Result<{
    entitlements: ModuleEntitlement[];
    changed: boolean;
    named: NamedAdministrator[];
  }>
>;

export type NameAdministrator = (
  tenantId: string,
  asked: {
    readonly entitlement: string;
    readonly accountId: string;
    readonly namedBy?: string | null;
  },
) => Promise<Result<NamedAdministrator>>;

export const ModuleNotAdministered = failure(
  'MODULE_NOT_ADMINISTERED',
  'That module has no administrator to name',
  ['entitlement'],
);

/** Every named account must be one that can sign in at this company. */
async function usable(
  scope: ModulesScope,
  named: readonly NamedAdministrator[],
): Promise<Result<void>> {
  for (const administrator of named) {
    const status = await scope.accountStatus(administrator.accountId);
    if (status === null || !mayAdminister(status)) {
      return err(AdministratorUnusable(administrator.entitlement));
    }
  }
  return ok(undefined);
}

export function setEntitlements({ inTenant }: ModulesDeps): SetEntitlements {
  return async (tenantId, asked) => {
    const checked = checkEntitlements(asked.entitlements);
    if (!checked.ok) return checked;
    return inTenant(tenantId, async (scope) => {
      const current = await scope.modules();
      if (current === null) return err(TenantUnknown);
      const named = administratorsToName(
        current.effective,
        checked.value,
        asked.administrators ?? {},
      );
      if (!named.ok) return named;
      const accounts = await usable(scope, named.value);
      if (!accounts.ok) return accounts;

      const changed = current.recorded === null || current.recorded.join() !== checked.value.join();
      if (changed) await scope.save(checked.value);
      for (const administrator of named.value) {
        await scope.name(administrator, asked.namedBy ?? null);
      }
      return ok({ entitlements: checked.value, changed, named: named.value });
    });
  };
}

/**
 * Name an administrator for a module the company already has: the recovery
 * path for a company that lost every one, and the first one for a company
 * that had the module before anybody had to be named.
 */
export function nameAdministrator({ inTenant }: ModulesDeps): NameAdministrator {
  return (tenantId, asked) =>
    inTenant(tenantId, async (scope): Promise<Result<NamedAdministrator>> => {
      const entitlement = ADMINISTERED_MODULES.find((m) => m === asked.entitlement);
      if (entitlement === undefined) return err(ModuleNotAdministered);
      const current = await scope.modules();
      if (current === null) return err(TenantUnknown);
      if (!current.effective.includes(entitlement)) return err(ModuleNotEnabled(entitlement));
      const administrator = { entitlement, accountId: asked.accountId };
      const accounts = await usable(scope, [administrator]);
      if (!accounts.ok) return accounts;
      await scope.name(administrator, asked.namedBy ?? null);
      return ok(administrator);
    });
}

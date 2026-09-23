import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import { ADMINISTERED_MODULES, type ModuleEntitlement } from '@kithena/contracts';

/**
 * Who first administers a module (PEO-112). Pure.
 *
 * A module in `ADMINISTERED_MODULES` cannot be switched on without the back
 * office naming an existing account to administer it: that is the only way
 * anybody first holds the module's administrator role. Naming one for a
 * module already on is allowed too — it is how a company that lost every
 * administrator gets one back.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NamedAdministrator {
  readonly entitlement: ModuleEntitlement;
  readonly accountId: string;
}

export const AdministratorRequired = (entitlement: string): DomainFailure =>
  failure(
    'ADMINISTRATOR_REQUIRED',
    'Name who will administer this module: somebody with an account at the company',
    ['administrators', entitlement],
  );

export const ModuleNotEnabled = (entitlement: string): DomainFailure =>
  failure('MODULE_NOT_ENABLED', 'The company does not have that module', [
    'administrators',
    entitlement,
  ]);

export const AdministratorUnusable = (entitlement: string): DomainFailure =>
  failure(
    'ADMINISTRATOR_UNUSABLE',
    'That person has no account at this company that can still sign in',
    ['administrators', entitlement],
  );

/**
 * The administrators a change of modules names: one for each administered
 * module switched on by it, which must be given, and any other given for a
 * module the company will have.
 */
export function administratorsToName(
  before: readonly ModuleEntitlement[],
  after: readonly ModuleEntitlement[],
  named: Readonly<Record<string, string>>,
): Result<NamedAdministrator[]> {
  for (const entitlement of Object.keys(named)) {
    if (!(after as readonly string[]).includes(entitlement)) {
      return err(ModuleNotEnabled(entitlement));
    }
  }
  const out: NamedAdministrator[] = [];
  for (const entitlement of ADMINISTERED_MODULES) {
    if (!after.includes(entitlement)) continue;
    const accountId = named[entitlement];
    const switchedOn = !before.includes(entitlement);
    if (accountId === undefined) {
      if (switchedOn) return err(AdministratorRequired(entitlement));
      continue;
    }
    if (!UUID.test(accountId)) return err(AdministratorRequired(entitlement));
    out.push({ entitlement, accountId });
  }
  return ok(out);
}

/** An account that can still sign in, or will once it enrols. */
export function mayAdminister(status: string): boolean {
  return status === 'provisioned' || status === 'invited' || status === 'active';
}

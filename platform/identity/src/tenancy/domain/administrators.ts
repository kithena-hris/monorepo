import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import { ADMINISTERED_MODULES, type ModuleEntitlement } from '@kithena/contracts';

/**
 * Who first administers a module (PEO-112). Pure.
 *
 * A module in `ADMINISTERED_MODULES` cannot be switched on without the back
 * office naming an existing account to administer it: that is the only way
 * anybody first holds the module's administrator role. Naming one for a
 * module already on is allowed too — it is how a company that lost every
 * administrator gets one back. A module may have several, and the back office
 * may remove any but the last.
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

export const LastAdministrator = (entitlement: string): DomainFailure =>
  failure(
    'LAST_ADMINISTRATOR',
    'A module keeps at least one administrator: name somebody else before removing the last',
    ['administrators', entitlement],
  );

/**
 * What the back office asks of one module's administrators: an account id
 * to name (the older, single form — it names that one and removes nobody),
 * or the whole list the module should have afterwards.
 */
export type AskedAdministrators = string | readonly string[];

export interface AdministratorChanges {
  readonly named: readonly NamedAdministrator[];
  readonly removed: readonly NamedAdministrator[];
}

/**
 * Who a change of modules names and who it removes (PEO-112).
 *
 * `current` is who the back office has named so far, per module. An
 * administered module switched on must be given somebody; a list replaces the
 * module's administrators and may not be empty while the module has any, so a
 * module never loses its last one. A module not mentioned keeps what it has —
 * including a module switched on before anybody had to be named, which has
 * none until somebody is.
 */
export function administratorChanges(
  before: readonly ModuleEntitlement[],
  after: readonly ModuleEntitlement[],
  current: Readonly<Record<string, readonly string[]>>,
  asked: Readonly<Record<string, AskedAdministrators>>,
): Result<AdministratorChanges> {
  for (const entitlement of Object.keys(asked)) {
    if (!(after as readonly string[]).includes(entitlement)) {
      return err(ModuleNotEnabled(entitlement));
    }
  }
  const named: NamedAdministrator[] = [];
  const removed: NamedAdministrator[] = [];
  for (const entitlement of ADMINISTERED_MODULES) {
    if (!after.includes(entitlement)) continue;
    const wanted = asked[entitlement];
    const switchedOn = !before.includes(entitlement);
    if (wanted === undefined) {
      if (switchedOn) return err(AdministratorRequired(entitlement));
      continue;
    }
    const list = typeof wanted === 'string' ? [wanted] : [...new Set(wanted)];
    if (list.some((id) => !UUID.test(id))) return err(AdministratorRequired(entitlement));
    const had = current[entitlement] ?? [];
    if (list.length === 0) {
      if (switchedOn) return err(AdministratorRequired(entitlement));
      if (had.length > 0) return err(LastAdministrator(entitlement));
      continue;
    }
    // The single form names again even somebody already named: it is how a
    // company that lost its administrators in the module gets one back.
    for (const accountId of list) {
      if (typeof wanted === 'string' || !had.includes(accountId)) {
        named.push({ entitlement, accountId });
      }
    }
    if (typeof wanted === 'string') continue;
    for (const accountId of had) {
      if (!list.includes(accountId)) removed.push({ entitlement, accountId });
    }
  }
  return ok({ named, removed });
}

/** An account that can still sign in, or will once it enrols. */
export function mayAdminister(status: string): boolean {
  return status === 'provisioned' || status === 'invited' || status === 'active';
}

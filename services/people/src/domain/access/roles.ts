import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Tenant roles, granted and revoked (PEO-112; PRD §6.6). Pure.
 *
 * Three rules, and the order they are asked in is the order a refusal is
 * explained in:
 *
 * - only a `people_admin` grants or revokes;
 * - nobody grants a role to themselves — an administrator who wants to be
 *   finance asks another administrator, so every grant has two people in it;
 * - the last `people_admin` is never revoked, not even by themselves, or the
 *   tenant is left with nobody who can grant anything and only the back
 *   office can recover it.
 *
 * `held` is who holds what now, read under the tenant's role lock, so the
 * answer cannot be overtaken by a concurrent change.
 */

export const TENANT_ROLES = ['hr', 'finance', 'people_admin'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Account → the tenant roles it holds. */
export type Holdings = ReadonlyMap<string, ReadonlySet<string>>;

export interface RoleChange {
  /** The account deciding. */
  readonly actor: string;
  /** The account the role is granted to or revoked from. */
  readonly target: string;
  readonly role: TenantRole;
  readonly reason: string;
}

export const NotAnAdministrator = failure(
  'FORBIDDEN',
  'Only a People administrator may grant or revoke a role',
);
export const SelfGrant = failure(
  'SELF_GRANT',
  'Nobody may grant a role to themselves; ask another People administrator',
  ['accountId'],
);
export const LastAdministrator = failure(
  'LAST_ADMIN',
  'This is the last People administrator. Make somebody else one first',
  ['accountId'],
);
export const ReasonRequired = failure(
  'REASON_REQUIRED',
  'Say why, in up to 500 characters: it is kept with the change',
  ['reason'],
);

const holds = (held: Holdings, account: string, role: string): boolean =>
  held.get(account)?.has(role) === true;

function checked(held: Holdings, change: RoleChange): Result<void> {
  if (!holds(held, change.actor, 'people_admin')) return err(NotAnAdministrator);
  const reason = change.reason.trim();
  if (reason === '' || reason.length > 500) return err(ReasonRequired);
  return ok(undefined);
}

export function decideGrant(held: Holdings, change: RoleChange): Result<'grant' | 'unchanged'> {
  const allowed = checked(held, change);
  if (!allowed.ok) return allowed;
  if (change.actor === change.target) return err(SelfGrant);
  return ok(holds(held, change.target, change.role) ? 'unchanged' : 'grant');
}

export function decideRevoke(held: Holdings, change: RoleChange): Result<'revoke' | 'unchanged'> {
  const allowed = checked(held, change);
  if (!allowed.ok) return allowed;
  if (!holds(held, change.target, change.role)) return ok('unchanged');
  if (change.role === 'people_admin') {
    const others = [...held].some(
      ([account, roles]) => account !== change.target && roles.has('people_admin'),
    );
    if (!others) return err(LastAdministrator);
  }
  return ok('revoke');
}

/** What the back office naming somebody grants, and removing them takes back. */
export const ADMINISTRATOR_ROLES = ['people_admin', 'hr'] as const satisfies readonly TenantRole[];

/**
 * The back office removing an administrator it named: which of
 * `ADMINISTRATOR_ROLES` to take back, and which of those nobody else holds.
 *
 * Leaving the company with no People administrator or no HR is something an
 * operator is warned about and has to confirm. Confirmed, everything naming
 * gave goes; not confirmed — an older back office, a caller that skipped the
 * warning — nothing does, so an unconfirmed removal can never strand a
 * company. `last` says why, for the log.
 */
export function backOfficeRemoval(
  held: Holdings,
  accountId: string,
  confirmedLast: boolean,
): { readonly revoke: readonly TenantRole[]; readonly last: readonly TenantRole[] } {
  const revoke = ADMINISTRATOR_ROLES.filter((role) => holds(held, accountId, role));
  const last = revoke.filter(
    (role) => ![...held].some(([account, roles]) => account !== accountId && roles.has(role)),
  );
  return { revoke: last.length > 0 && !confirmedLast ? [] : revoke, last };
}

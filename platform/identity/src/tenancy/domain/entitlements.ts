import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { ModuleEntitlement, moduleEntitlements } from '@kithena/contracts';

/**
 * Which modules a company bought (PEO-114). Pure.
 *
 * Recorded by the back office, on the company, and the one place the answer
 * lives: every module learns it from `identity.tenant.entitlements_changed`,
 * and the tenant app from the session. The deployment's list
 * (`KITHENA_ENTITLEMENTS`) is what a company with nothing recorded has — a
 * default, never an override.
 */

export const EntitlementUnknown = failure(
  'ENTITLEMENT_UNKNOWN',
  'That is not a module Kithena sells',
  ['entitlements'],
);

/**
 * A list an operator asked for, checked whole. An unknown module is refused
 * rather than dropped: an operator who ticked something must not be told it
 * saved when part of it did not.
 */
export function checkEntitlements(asked: readonly string[]): Result<ModuleEntitlement[]> {
  if (asked.some((key) => !ModuleEntitlement.safeParse(key).success)) {
    return err(EntitlementUnknown);
  }
  return ok(moduleEntitlements(asked));
}

/** What a company holds: its own list, or the deployment's when it has none. */
export function effectiveEntitlements(
  recorded: readonly ModuleEntitlement[] | null,
  deploymentDefault: readonly ModuleEntitlement[],
): ModuleEntitlement[] {
  return [...(recorded ?? deploymentDefault)];
}

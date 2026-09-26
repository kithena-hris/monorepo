import * as z from 'zod';
import { asPublic, policy } from './classification.js';
import { ModuleKey } from './module.js';

export const EntitlementKey = z.string().brand<'EntitlementKey'>();
export type EntitlementKey = z.infer<typeof EntitlementKey>;

/**
 * A module a tenant may have bought: `module.<key>` (PEO-114).
 *
 * Derived from `ModuleKey`, so a module that does not exist cannot be sold.
 * Which modules a tenant holds is the back office's to record, in
 * `platform.tenant.entitlements`; a tenant with none recorded has the
 * deployment's list (`KITHENA_ENTITLEMENTS`), which is a default and nothing
 * more. A company fact, not personal data.
 */
export const ModuleEntitlement = z
  .templateLiteral(['module.', ModuleKey])
  .register(policy, asPublic());
export type ModuleEntitlement = z.infer<typeof ModuleEntitlement>;

/** The modules Kithena ships today: what the back office offers to switch on. */
export const OFFERED_MODULES: readonly ModuleEntitlement[] = ['module.people', 'module.timeoff'];

/**
 * Modules that cannot be switched on without naming who administers them
 * (PEO-112). The back office names one or more existing accounts; the module
 * grants each its administrator role from `identity.tenant.administrator_named`
 * and takes it back on `identity.tenant.administrator_removed`. Nobody is an
 * administrator because they happened to be first.
 *
 * Every module Kithena offers: an operator names who runs each, the same
 * people for all or different ones. A module with no roles of its own yet
 * (Time off) receives the naming and ignores it until it has somebody to
 * grant.
 */
export const ADMINISTERED_MODULES: readonly ModuleEntitlement[] = [
  'module.people',
  'module.timeoff',
];

/**
 * A list of modules from configuration or storage: the known ones, once
 * each, in a stable order. Anything else is dropped rather than trusted.
 */
export function moduleEntitlements(values: readonly unknown[]): ModuleEntitlement[] {
  const known = values.filter(
    (v): v is ModuleEntitlement => ModuleEntitlement.safeParse(v).success,
  );
  return [...new Set(known)].toSorted();
}

/** `KITHENA_ENTITLEMENTS`, a JSON array; anything unparseable is no modules. */
export function deploymentEntitlements(raw: string | undefined): ModuleEntitlement[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? moduleEntitlements(parsed) : [];
  } catch {
    return [];
  }
}

export const MeterKey = z.enum([
  'active_employees',
  'api_calls',
  'documents_stored_bytes',
  'workflow_runs',
]);
export type MeterKey = z.infer<typeof MeterKey>;

export const EntitlementLimits = z.object({
  seats: z.union([z.int().positive(), z.literal('unlimited')]),
  /** Warn, keep working. */
  softLimit: z.int().positive().nullable(),
  /** Block new writes. Never blocks reads: locking a company out of its own
   *  employee records over a billing dispute loses the account and may
   *  breach a data access obligation. */
  hardLimit: z.int().positive().nullable(),
});
export type EntitlementLimits = z.infer<typeof EntitlementLimits>;

export interface EntitlementService {
  has(tenantId: string, key: EntitlementKey): Promise<boolean>;
  limits(tenantId: string, key: EntitlementKey): Promise<EntitlementLimits>;
  record(tenantId: string, meter: MeterKey, quantity: number, at: Date): Promise<void>;
}

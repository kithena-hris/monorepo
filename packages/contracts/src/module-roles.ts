import * as z from 'zod';

import { asInternal, asPublic, policy } from './classification.js';
import { AccountId } from './events/identity.js';

/**
 * Who holds a module's administrator roles, as the module itself sees them:
 * `PUT /api/internal/tenants/<id>/module-roles/<entitlement>`.
 *
 * The module reports and identity keeps the latest report, so the back office
 * can show what it set beside what the module actually has without reading
 * the module's tables or asking the module directly. The two lists are
 * allowed to differ — a company grants and revokes its own roles — and nothing
 * reconciles them; the back office only shows where they part.
 *
 * A snapshot, never a delta: the whole list each time, ordered by `asOf`, so a
 * report lost or delivered late is overtaken by the next one.
 */
export const ModuleRoleHolder = z.object({
  accountId: AccountId,
  /** The administrator roles this account holds in the module; never empty. */
  roles: z.array(z.string().min(1).max(64)).min(1).register(policy, asPublic()),
});
export type ModuleRoleHolder = z.infer<typeof ModuleRoleHolder>;

export const ModuleRoleReport = z.object({
  /** When the module read its roles. An older report than the one kept is ignored. */
  asOf: z.iso.datetime({ offset: true }).register(policy, asInternal()),
  /** What the back office naming somebody grants in this module: People's `people_admin` and `hr`. */
  administratorRoles: z.array(z.string().min(1).max(64)).min(1).register(policy, asPublic()),
  /** Everybody holding at least one of `administratorRoles`. */
  holders: z.array(ModuleRoleHolder).max(2_000),
});
export type ModuleRoleReport = z.infer<typeof ModuleRoleReport>;

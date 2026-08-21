import type { EntitlementService } from '@kithena/contracts';
import type { AuthorizationContext } from './principal.js';

/**
 * Permission asks "is this person allowed". Entitlement asks "did this
 * company buy this module". Both must pass, and they are not the same
 * question. Conflating them is how a customer ends up using a module they
 * never purchased.
 */
export function assertEntitled(ctx: AuthorizationContext, key: string): void {
  if (!ctx.entitlements.has(key)) {
    throw Object.assign(new Error(`Not entitled: ${key}`), { code: 'NOT_ENTITLED' });
  }
}

export interface EntitlementGuardOptions {
  readonly service: EntitlementService;
  /** Reads are never hard-blocked, whatever the billing state. */
  readonly operation: 'read' | 'write';
}

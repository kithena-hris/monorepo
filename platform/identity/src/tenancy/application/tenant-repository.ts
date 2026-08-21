import type { Tenant } from '../domain/tenant.js';

/**
 * The one thing this slice needs from storage.
 *
 * One method because there is one need. A `TenantRepository` that also listed,
 * counted and searched would be a port every future slice is tempted to widen,
 * and the widening is what turns a boundary into a namespace.
 *
 * Declared in the application layer and implemented in infrastructure, so the
 * use case below depends on a shape it defines rather than on Drizzle.
 */
export interface TenantRepository {
  /** The tenant holding this slug, or null. Never throws for "not found". */
  bySlug(slug: string): Promise<Tenant | null>;
}

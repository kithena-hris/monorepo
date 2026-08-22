import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TenantStatus } from '@kithena/contracts';

import type { TenantRepository } from '../application/tenant-repository.js';
import { brandingFor, type Tenant } from '../domain/tenant.js';
import { tenant } from './tenant-table.js';

/**
 * The registry, read.
 *
 * The status column is `text` with a CHECK constraint rather than an enum, so
 * the database can gain a state without a type migration. That means the value
 * arrives here as an unconstrained string, and it is *parsed* rather than cast:
 * a row holding a status this build has never heard of resolves to nothing,
 * which is the failure this whole path is written to prefer.
 */
export function drizzleTenantRepository(db: PostgresJsDatabase): TenantRepository {
  return {
    async bySlug(slug) {
      const rows = await db
        .select({
          id: tenant.id,
          slug: tenant.slug,
          status: tenant.status,
          displayName: tenant.displayName,
          logoUrl: tenant.logoUrl,
          accentColor: tenant.accentColor,
          brandingPublic: tenant.brandingPublic,
        })
        .from(tenant)
        .where(eq(tenant.slug, slug))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const status = TenantStatus.safeParse(row.status);
      if (!status.success) return null;

      return {
        id: row.id,
        slug: row.slug,
        status: status.data,
        branding: brandingFor(row),
      } satisfies Tenant;
    },
  };
}

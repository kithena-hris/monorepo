import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Result } from '@kithena/domain-kit';

import type { OrgAdmin } from '../org/org.js';
import { inTenantResult, type PersonAccess } from './person-access.js';
import type { SchemaVersions } from './ports.js';

/** One tenant transaction, as `tenantTransaction` in infrastructure provides it. */
export type InTenant = <R>(
  tenantId: string,
  fn: (scope: { tx: PostgresJsDatabase }) => Promise<R>,
) => Promise<R>;

/** What a transport is handed: the use cases, the versions, and a way to open a transaction. */
export interface PeopleService {
  readonly access: PersonAccess;
  readonly schemas: SchemaVersions;
  readonly inTenant: InTenant;
  /** Legal entities, locations and settings. Absent, those routes answer UNAVAILABLE. */
  readonly org?: OrgAdmin;
}

/** A use case in its own tenant transaction, rolled back when it refuses. */
export function run<T>(
  service: PeopleService,
  tenantId: string,
  fn: (tx: PostgresJsDatabase) => Promise<Result<T>>,
): Promise<Result<T>> {
  return inTenantResult(service.inTenant, tenantId, fn);
}

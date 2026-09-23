import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Result } from '@kithena/domain-kit';

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
}

/** A use case in its own tenant transaction, rolled back when it refuses. */
export function run<T>(
  service: PeopleService,
  tenantId: string,
  fn: (tx: PostgresJsDatabase) => Promise<Result<T>>,
): Promise<Result<T>> {
  return inTenantResult(service.inTenant, tenantId, fn);
}

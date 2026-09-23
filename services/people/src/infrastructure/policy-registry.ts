import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { tenantPolicies, type PolicyRegistry, type TenantField } from '@kithena/telemetry';

import type { SchemaDocument } from '../domain/schema/publish.js';
import { schemaVersion } from './tables.js';
import type { InTenantTransaction } from './unit-of-work.js';

/**
 * People's half of the runtime policy registry (PRD §12.2).
 *
 * `@kithena/telemetry` holds the union and knows nothing about People; this
 * file is what fills it: every attribute a tenant has published, read at boot
 * and re-read on `people.schema.published`.
 *
 * **Every published version, not only the current one.** A rollback publishes
 * older content as a new version, so an attribute added in v2 and rolled back
 * in v3 is absent from the current document while the values written under v2
 * are still on the rows. Reading the current version alone would stop
 * redacting them. Reading them all means a field once classified confidential
 * stays redacted — the registry's `replace` treats any sensitive occurrence as
 * sensitive — which is the side to err on.
 */

/** The published document for one version, or null. For the DSAR, which reads the version a record was written under. */
export async function publishedDocument(
  tx: PostgresJsDatabase,
  tenantId: string,
  version: number,
): Promise<SchemaDocument | null> {
  const rows = await tx
    .select({ document: schemaVersion.document })
    .from(schemaVersion)
    .where(and(eq(schemaVersion.tenantId, tenantId), eq(schemaVersion.version, version)))
    .limit(1);
  return (rows[0]?.document as SchemaDocument | undefined) ?? null;
}

/** Every attribute of every published version, oldest version first. */
export async function publishedAttributes(
  tx: PostgresJsDatabase,
  tenantId: string,
): Promise<SchemaDocument['attributes']> {
  const rows = await tx
    .select({ document: schemaVersion.document })
    .from(schemaVersion)
    .where(eq(schemaVersion.tenantId, tenantId))
    .orderBy(asc(schemaVersion.version));
  return rows.flatMap(({ document }) => (document as SchemaDocument).attributes);
}

/** Load one tenant into the registry, in the caller's tenant transaction. */
export async function loadTenantPolicies(
  tx: PostgresJsDatabase,
  tenantId: string,
  registry: PolicyRegistry = tenantPolicies,
): Promise<void> {
  const fields: TenantField[] = (await publishedAttributes(tx, tenantId)).map((a) => ({
    key: a.key,
    policy: a.classification,
    encrypted: a.encrypted,
  }));
  registry.replace(tenantId, fields);
}

/**
 * The handler for `people.schema.published`.
 *
 * Anything else is ignored, so it can sit on the module's own topic. Reloads
 * in a fresh tenant transaction, because the event arrives from outside any
 * unit of work and RLS reads nothing without `app.tenant_id` set.
 */
export function onSchemaPublished(
  inTenant: InTenantTransaction,
  registry: PolicyRegistry = tenantPolicies,
): (event: { readonly eventName: string; readonly tenantId: string }) => Promise<void> {
  return async (event) => {
    if (event.eventName !== 'people.schema.published') return;
    await inTenant(event.tenantId, ({ tx }) => loadTenantPolicies(tx, event.tenantId, registry));
  };
}

/**
 * Boot: load every tenant this process serves.
 *
 * The list is the caller's, because `svc_people` cannot enumerate tenants —
 * RLS scopes every People table to the one in the transaction. A tenant left
 * out is not unprotected: the registry fails closed for it until it loads.
 */
export async function wirePolicyRegistry(
  inTenant: InTenantTransaction,
  tenantIds: readonly string[],
  registry: PolicyRegistry = tenantPolicies,
): Promise<void> {
  for (const tenantId of tenantIds) {
    // eslint-disable-next-line no-await-in-loop -- one transaction per tenant, at boot
    await inTenant(tenantId, ({ tx }) => loadTenantPolicies(tx, tenantId, registry));
  }
}

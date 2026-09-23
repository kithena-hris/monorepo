import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { SchemaDraft } from '../domain/schema/draft.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { attributeDefinition, section } from '../infrastructure/tables.js';
import { applyPack, type CountryPack } from './packs.js';

const schema = drizzleSchemaRepository();

/**
 * Write a pack into a tenant's draft, in the caller's transaction.
 *
 * Rows, not a version: publishing stays the admin's act, through
 * `publishSchema`, exactly as for anything they typed themselves. The rows go
 * through `SchemaDraft` first so a pack is held to every check a settings
 * screen is, and `ON CONFLICT DO NOTHING` makes two concurrent applies a no-op
 * rather than a failed transaction.
 */
export async function seedCountryPack(
  tx: PostgresJsDatabase,
  tenantId: string,
  pack: CountryPack,
): Promise<ReturnType<typeof applyPack>> {
  const current = await schema.loadDraft(tx, tenantId);
  const applied = applyPack(SchemaDraft.rehydrate(current.sections, current.attributes), pack);
  if (!applied.ok) return applied;

  const { sections, attributes } = applied.value;

  if (sections.length > 0) {
    await tx
      .insert(section)
      .values(
        sections.map((s) => ({
          tenantId,
          key: s.key,
          labels: s.label,
          ord: s.order,
          visibility: [...s.defaultVisibility],
          origin: s.origin,
        })),
      )
      .onConflictDoNothing();
  }

  if (attributes.length > 0) {
    await tx
      .insert(attributeDefinition)
      .values(
        attributes.map((a) => ({
          tenantId,
          key: a.key,
          sectionKey: a.sectionKey,
          labels: a.label,
          description: a.description,
          ord: a.order,
          dataType: a.dataType,
          typeConfig: a.typeConfig,
          cardinality: a.cardinality,
          requiredness: a.requiredness,
          ownership: [...a.ownership],
          visibility: [...a.visibility],
          collectAt: a.collectAt,
          classification: a.classification,
          classificationSource: a.classificationSource,
          effectiveDated: a.effectiveDated,
          uniqueScope: a.uniqueScope,
          encrypted: a.encrypted,
          indexed: a.indexed,
          includeInDirectory: a.includeInDirectory,
          includeInEvents: a.includeInEvents,
          origin: a.origin,
        })),
      )
      .onConflictDoNothing();
  }

  return applied;
}

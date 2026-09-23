import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { outboxTable, publish as publishEvents } from '@kithena/db-kit';

import type { PeopleFactsReader, SchemaRepository } from '../application/schema/schema-repository.js';
import type { EvaluablePerson } from '../application/schema/impact.js';
import type { Attribute, Section } from '../domain/schema/draft.js';
import type { SchemaDocument } from '../domain/schema/publish.js';
import { SectionKey, type PersonStatus } from '@kithena/contracts';
import { attributeDefinition, person, schemaVersion, section } from './tables.js';

/**
 * The registry, as Drizzle.
 *
 * Rows to domain objects and back. The one thing worth saying is what is not
 * here: no method writes a version without its events, for the same reason the
 * person repository has none — an event without the row it describes is a
 * consumer fetching a version that does not exist.
 */

const outbox = outboxTable('people');

export function drizzleSchemaRepository(): SchemaRepository {
  return {
    async loadDraft(tx, tenantId) {
      const [sections, attributes] = await Promise.all([
        tx
          .select()
          .from(section)
          .where(eq(section.tenantId, tenantId))
          .orderBy(asc(section.ord), asc(section.key)),
        tx
          .select()
          .from(attributeDefinition)
          .where(eq(attributeDefinition.tenantId, tenantId))
          .orderBy(asc(attributeDefinition.ord), asc(attributeDefinition.key)),
      ]);

      return {
        sections: sections.map(toSection),
        attributes: attributes.map(toAttribute),
      };
    },

    async currentVersion(tx, tenantId) {
      const rows = await tx
        .select()
        .from(schemaVersion)
        .where(eq(schemaVersion.tenantId, tenantId))
        .orderBy(desc(schemaVersion.version))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return {
        version: row.version,
        document: row.document as SchemaDocument,
        checksum: row.checksum,
        publishedAt: row.publishedAt.toISOString(),
        publishedBy: row.publishedBy,
        rolledBackFrom: row.rolledBackFrom,
      };
    },

    async appendVersion(tx, tenantId, version, events, evaluatedOn) {
      await tx.insert(schemaVersion).values({
        tenantId,
        version: version.version,
        publishedAt: new Date(version.publishedAt),
        publishedBy: version.publishedBy,
        checksum: version.checksum,
        document: version.document,
        rolledBackFrom: version.rolledBackFrom,
        evaluatedOn,
      });

      // Same transaction as the row, which is the whole mechanism.
      await publishEvents(tx, outbox, events);
    },
  };
}

/**
 * The people a publish is evaluated against, in pages.
 *
 * Keyset by id rather than OFFSET: `OFFSET 40000` makes Postgres produce and
 * discard forty thousand rows to return a hundred, so the last page of a large
 * tenant costs the most — which is exactly the tenant this exists for.
 *
 * Only the columns a predicate can read. A `SELECT *` here would pull every
 * salary and every JSONB bag through the impact walk to count how many people
 * lack a cost centre.
 */
export function drizzlePeopleFacts(): PeopleFactsReader {
  return {
    async *forImpact(tx, tenantId, pageSize = 500) {
      let after = '00000000-0000-0000-0000-000000000000';

      for (;;) {
        const rows = await tx
          .select({
            id: person.id,
            status: person.status,
            legalEntityId: person.legalEntityId,
            employmentType: person.employmentType,
            workModel: person.workModel,
            custom: person.custom,
          })
          .from(person)
          .where(and(eq(person.tenantId, tenantId), gt(person.id, after)))
          .orderBy(asc(person.id))
          .limit(pageSize);

        if (rows.length === 0) return;

        for (const row of rows) {
          yield toEvaluable(row);
        }

        after = rows.at(-1)?.id ?? after;
        if (rows.length < pageSize) return;
      }
    },
  };
}

/**
 * The country a predicate reads.
 *
 * `people.person` has no country column: a person's country comes from their
 * address, which lives in `custom` under whichever key the tenant's registry
 * calls it. Read from the conventional key rather than joined from a table
 * that does not exist, and null when the tenant has no such field — which
 * `evaluateRequiredness` treats as "the clause does not hold" rather than as
 * an error.
 */
function countryOf(custom: Record<string, unknown>): string | null {
  const address = custom['home_address'];
  if (typeof address === 'object' && address !== null) {
    const country = (address as { country?: unknown }).country;
    if (typeof country === 'string') return country;
  }
  const direct = custom['country'];
  return typeof direct === 'string' ? direct : null;
}

function toEvaluable(row: {
  id: string;
  status: string;
  legalEntityId: string | null;
  employmentType: string | null;
  workModel: string | null;
  custom: unknown;
}): EvaluablePerson {
  const custom = (row.custom ?? {}) as Record<string, unknown>;

  return {
    personId: row.id,
    facts: {
      legalEntityId: row.legalEntityId,
      country: countryOf(custom),
      employmentType: row.employmentType as EvaluablePerson['facts']['employmentType'],
      workModel: row.workModel as EvaluablePerson['facts']['workModel'],
      status: row.status as PersonStatus,
      values: custom,
      // Filled in by the caller's document: which attributes the published
      // version still knows about is a property of the version, not of the
      // row. `computeImpact` passes the definitions, and a predicate naming
      // something absent from them evaluates to not-required with a signal.
      knownAttributes: new Set(Object.keys(custom)),
    },
  };
}

/*
 * Row names and domain names differ, and deliberately.
 *
 * The column is `labels` because a JSONB map of them is what it holds; the
 * domain field is `label` because one is what a screen renders. `ord` is
 * `order` for the same reason in reverse — `order` is a reserved word in SQL
 * and quoting it in every query is a tax on a name nobody reads.
 */
function toSection(row: typeof section.$inferSelect): Section {
  return {
    key: SectionKey.parse(row.key),
    label: row.labels as Section['label'],
    order: row.ord,
    defaultVisibility: row.visibility as Section['defaultVisibility'],
    origin: row.origin as Section['origin'],
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function toAttribute(row: typeof attributeDefinition.$inferSelect): Attribute {
  return {
    key: row.key,
    sectionKey: row.sectionKey,
    label: row.labels,
    description: row.description,
    order: row.ord,
    dataType: row.dataType,
    typeConfig: row.typeConfig,
    cardinality: row.cardinality,
    requiredness: row.requiredness,
    ownership: row.ownership,
    visibility: row.visibility,
    collectAt: row.collectAt,
    classification: row.classification,
    classificationSource: row.classificationSource,
    effectiveDated: row.effectiveDated,
    uniqueScope: row.uniqueScope,
    encrypted: row.encrypted,
    indexed: row.indexed,
    includeInDirectory: row.includeInDirectory,
    includeInEvents: row.includeInEvents,
    origin: row.origin,
    deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
  } as Attribute;
}

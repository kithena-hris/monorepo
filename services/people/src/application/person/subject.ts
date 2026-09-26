import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EmploymentType, WorkModel } from '@kithena/contracts';

import type { ExternalSource } from '../../domain/access/field-access.js';
import type { PersonFacts } from '../../domain/schema/requiredness.js';
import type { PersonReader, PersonRecord, RelationsResolver } from './ports.js';

/**
 * The person a viewer is looking at, for custom visibility rules (PEO-066).
 *
 * A rule is true of some records, so `visibleTo` needs the record's facts
 * beside the viewer's relations. They travel on the relations because the
 * relations are already resolved per person and threaded through every read
 * — the profile, the record screen, history, completeness, reviews, exports,
 * the AI deny list — so one wrapper at the wiring reaches all of them, and a
 * path that is not reached fails closed: no subject, no rule holds.
 */

/** A record's facts, as a predicate reads them. */
export function factsOf(record: PersonRecord): PersonFacts {
  const values = record.values;
  return {
    legalEntityId: record.legalEntityId,
    country: countryOf(values),
    employmentType: record.employmentType as EmploymentType | null,
    workModel: record.workModel as WorkModel | null,
    status: record.snapshot.status,
    values,
    // Only what the record holds. A clause on a key it does not hold cannot
    // be evaluated, which for a visibility rule is "not shown" — the same
    // answer a blank value would give, and the safe one.
    knownAttributes: new Set(Object.keys(values)),
  };
}

/** Where the person lives, as requiredness reads it (§6.5). */
export function countryOf(values: Readonly<Record<string, unknown>>): string | null {
  const address = values['home_address'];
  if (typeof address === 'object' && address !== null) {
    const country = (address as { country?: unknown }).country;
    if (typeof country === 'string') return country;
  }
  const direct = values['country'];
  return typeof direct === 'string' ? direct : null;
}

/** Which external systems own which attributes on a person (PEO-073); `ScimStore` has it. */
export interface ExternalSources {
  sources(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
  ): Promise<ReadonlyMap<string, ExternalSource>>;
}

const NOBODY = '00000000-0000-0000-0000-000000000000';

/**
 * A resolver whose per-person answer names the attributes an upstream
 * system owns on that person (PEO-073, PRD §13.6), so `canWrite` refuses
 * every other writer and every screen shows them read-only, naming the
 * system — on every path that resolves relations through it, which is every
 * transport's. A question about nobody in particular has no sources.
 */
export function withSources(resolver: RelationsResolver, external: ExternalSources): RelationsResolver {
  const reach = resolver.reach?.bind(resolver);
  return {
    ...(reach === undefined ? {} : { reach }),
    async relations(tx, tenantId, viewer, personId) {
      if (personId === NOBODY) return resolver.relations(tx, tenantId, viewer, personId);
      const [relations, sources] = await Promise.all([
        resolver.relations(tx, tenantId, viewer, personId),
        external.sources(tx, tenantId, personId),
      ]);
      return sources.size === 0 ? relations : { ...relations, sources };
    },
  };
}

/**
 * A resolver whose per-person answer carries the person's facts.
 *
 * ponytail: one more keyed read per person asked about. A page of people goes
 * through `relationsToMany`, which is handed the facts of the records it
 * already read and asks nothing more.
 */
export function withSubjects(resolver: RelationsResolver, reader: PersonReader): RelationsResolver {
  const reach = resolver.reach?.bind(resolver);
  return {
    ...(reach === undefined ? {} : { reach }),
    async relations(tx, tenantId, viewer, personId) {
      const [relations, record] = await Promise.all([
        resolver.relations(tx, tenantId, viewer, personId),
        reader.record(tx, tenantId, personId),
      ]);
      return record === null ? relations : { ...relations, subject: factsOf(record) };
    },
  };
}

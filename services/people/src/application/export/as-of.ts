import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { fixedClock, type Clock } from '@kithena/domain-kit';
import {
  CalendarDate,
  type AttributeDefinition,
  type EmploymentType,
  type WorkModel,
} from '@kithena/contracts';

import { visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import { assessCompleteness, notApplicable } from '../../domain/person/completeness.js';
import { valueAsOf } from '../../domain/person/history.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import type { PersonAccessDeps } from '../person/person-access.js';
import type { SchemaVersions } from '../person/ports.js';

/**
 * What an export says is missing, judged on the day it is about (PRD §15.4).
 *
 * An export `asOf` March is a picture of March, and its **Missing
 * information** sheet has to be too: the values in force then, against the
 * schema version in force then. Judged against today, a field added in June
 * shows every March row as missing something nobody could have been asked
 * for, and a gap closed in May vanishes from the March picture.
 *
 * ponytail: dated values replay through history; the record's status,
 * employment type, work model and legal entity are today's, and so is whether
 * an encrypted value exists — none of them has a dated read yet. A predicate
 * over one of those judges a past day by today's answer.
 */

export type RecordDeps = Pick<PersonAccessDeps, 'people' | 'reader' | 'secrets'>;

export interface Judgement {
  /** Required on the day, empty, and readable by this viewer. */
  readonly missing: ReadonlyMap<string, AttributeDefinition>;
  /** Empty because no rule asks for it of this person on the day. */
  readonly notApplicable: ReadonlySet<string>;
}

export const NOTHING_JUDGED: Judgement = { missing: new Map(), notApplicable: new Set() };

/** The version that was the published one at the end of `day`, or null before the first. */
export async function versionInForce(
  tx: PostgresJsDatabase,
  schemas: SchemaVersions,
  tenantId: string,
  day: string,
): Promise<PublishedVersion | null> {
  const versions = await schemas.list(tx, tenantId);
  const summary = versions.find((v) => v.publishedAt.slice(0, 10) <= day);
  if (!summary) return null;
  // `list` may carry only a summary; the document comes from `byNumber`.
  return (await schemas.byNumber(tx, tenantId, summary.version)) ?? summary;
}

/** A clock that reads `day` in every zone: a requiredness rule asks "is it in force today". */
function clockOn(day: string): Clock {
  const date = CalendarDate.parse(day);
  return { ...fixedClock(`${day}T12:00:00.000Z`), today: () => date, date: () => date };
}

export async function judge(
  tx: PostgresJsDatabase,
  records: RecordDeps,
  where: { tenantId: string; personId: string; day: string; asOf: boolean },
  version: PublishedVersion,
  relations: ViewerRelations,
): Promise<Judgement> {
  const record = await records.reader.record(tx, where.tenantId, where.personId);
  if (!record) return NOTHING_JUDGED;
  const definitions = version.document.attributes;

  const values: Record<string, unknown> = { ...record.values };
  if (definitions.some((d) => d.encrypted)) {
    for (const s of await records.secrets.list(tx, where.tenantId, where.personId)) {
      values[s.attributeKey] = true;
    }
  }
  if (where.asOf) {
    const history = await records.people.history(tx, where.tenantId, where.personId);
    for (const d of definitions) {
      if (!d.effectiveDated || d.encrypted) continue;
      const entry = valueAsOf(history, d.key, where.day);
      // Null rather than absent: both read as "no value" to a rule.
      values[d.key] = entry === undefined ? null : entry.value;
    }
  }

  const facts = {
    legalEntityId: record.legalEntityId,
    country: countryOf(values),
    employmentType: record.employmentType as EmploymentType | null,
    workModel: record.workModel as WorkModel | null,
    status: record.snapshot.status,
    values,
    knownAttributes: new Set(definitions.map((d) => d.key as string)),
  };
  const clock = clockOn(where.day);
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  const verdict = assessCompleteness(definitions, facts, clock);
  const missing = new Map<string, AttributeDefinition>();
  for (const m of verdict.missing) {
    const d = byKey.get(m.key);
    if (d && visibleTo(d, relations)) missing.set(m.key, d);
  }
  return { missing, notApplicable: new Set(notApplicable(definitions, facts, clock)) };
}

/** The convention `person-access.ts` and `drizzlePeopleFacts` read: an address's country, else a plain one. */
function countryOf(values: Record<string, unknown>): string | null {
  const address = values['home_address'];
  if (typeof address === 'object' && address !== null) {
    const country = (address as { country?: unknown }).country;
    if (typeof country === 'string') return country;
  }
  const direct = values['country'];
  return typeof direct === 'string' ? direct : null;
}

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition, EmploymentType, WorkModel } from '@kithena/contracts';

import { canWrite, visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import { assessCompleteness } from '../../domain/person/completeness.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import type { PersonAccess, PersonView } from '../person/person-access.js';
import type { RelationsResolver, SchemaVersions, Viewer } from '../person/ports.js';
import { coerceCell, coerceDate, isMasked, type DateOrder } from './cells.js';
import { SYSTEM_COLUMNS, type ColumnMapping } from './mapping.js';
import { PERSON_ID_COLUMN, type ParsedFile, type ParsedRow } from './parse.js';

/**
 * The dry run (PRD §14.4): every row classified before anything is written.
 *
 * create, update, unchanged, blocked or duplicate — and, separately, how many
 * of the rows that will import leave their person incomplete. The three kinds
 * of trouble are deliberately not symmetric:
 *
 *  - a **core identity** field missing on a new person blocks the row, because
 *    a record with no name, email, hire date or legal entity is a record
 *    nobody can find, match or invite;
 *  - any other **required** field missing lets the row import, incomplete —
 *    exactly §8.4 — because a source system that never held a cost centre
 *    must not make the file un-importable;
 *  - an **invalid** value blocks the row and names the cell, because a wrong
 *    value is worse than an absent one: absent shows as a gap, wrong does not.
 *
 * **Nothing is written.** Existing people are read through `PersonAccess`,
 * so the importer matches only against what they may read, and the commit
 * (PEO-041) recomputes this rather than trusting it.
 */

/** §14.4's list. Only the keys the published schema defines are demanded, plus the lifecycle's own. */
export const CORE_IDENTITY = [
  'given_name',
  'family_name',
  'work_email',
  'hire_date',
  'legal_entity_id',
] as const;

export type RowOutcome = 'create' | 'update' | 'unchanged' | 'blocked' | 'duplicate';

export interface CellProblem {
  readonly column: string;
  readonly key: string;
  readonly kind: 'missing' | 'invalid' | 'unknown_person';
  readonly reason: string;
}

export interface ClassifiedRow {
  readonly row: number;
  readonly cells: readonly string[];
  readonly outcome: RowOutcome;
  /** The existing person for update, unchanged and duplicate rows. */
  readonly personId: string | null;
  readonly matchedOn:
    'person_id' | 'work_email' | 'employee_number' | 'name_and_birth_date' | 'earlier_row' | null;
  /** Typed values to write, by attribute key. Only what differs, for an update. */
  readonly changes: Readonly<Record<string, unknown>>;
  readonly hireDate: string | null;
  readonly effectiveFrom: string | null;
  /** Why it is blocked. Empty otherwise. */
  readonly problems: readonly CellProblem[];
  /** Required keys still missing once this row is written. */
  readonly missing: readonly string[];
}

export interface DryRun {
  readonly rowsRead: number;
  readonly counts: Readonly<Record<RowOutcome, number>>;
  /** "missing work_email" → 11, "invalid hire_date" → 3. */
  readonly blockedBy: Readonly<Record<string, number>>;
  /** Of the rows that will import (create + update), how many leave a gap, and which. */
  readonly incomplete: { readonly count: number; readonly byKey: Readonly<Record<string, number>> };
  /** Never silent: every column that will not be imported, by header. */
  readonly ignoredColumns: readonly string[];
  /** Whether dated facts took a file column or the defaults (§14.5). */
  readonly effectiveFrom: 'column' | 'defaults';
  readonly rows: readonly ClassifiedRow[];
  readonly schemaVersion: number;
}

export interface DryRunDeps {
  readonly access: PersonAccess;
  readonly schemas: SchemaVersions;
  readonly relations: RelationsResolver;
  readonly clock: Clock;
}

export interface DryRunInput {
  readonly tenantId: string;
  readonly viewer: Viewer;
  readonly correlationId: string;
  readonly timeZone?: string;
  readonly file: ParsedFile;
  /** A resolved mapping: nothing left in review, nothing refused. */
  readonly mapping: readonly ColumnMapping[];
  readonly dateOrder?: DateOrder;
}

const isSystemColumn = (key: string) => Object.hasOwn(SYSTEM_COLUMNS, key);

/** An id no person has, for asking the importer's tenant-wide relations. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

const lower = (s: unknown) =>
  typeof s === 'string' ? s.normalize('NFC').trim().toLocaleLowerCase('en') : null;

/** The same equality a write would produce: values are JSON-shaped. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Existing {
  readonly byId: ReadonlyMap<string, PersonView>;
  readonly byEmail: ReadonlyMap<string, PersonView>;
  readonly byNumber: ReadonlyMap<string, PersonView>;
  readonly byNameAndBirth: ReadonlyMap<string, PersonView>;
}

const nameAndBirth = (v: Readonly<Record<string, unknown>>): string | null => {
  const given = lower(v['given_name']);
  const family = lower(v['family_name']);
  const born = v['date_of_birth'];
  return given && family && typeof born === 'string' ? `${given}|${family}|${born}` : null;
};

/**
 * Everybody the importer may read, indexed for matching.
 *
 * ponytail: the whole tenant, in pages of 500, held while the file is
 * classified. 50,000 people is the file limit and fits; past that, match by
 * querying the candidate keys the file actually contains.
 */
async function existingPeople(
  tx: PostgresJsDatabase,
  deps: DryRunDeps,
  input: DryRunInput,
): Promise<Result<Existing>> {
  const byId = new Map<string, PersonView>();
  const byEmail = new Map<string, PersonView>();
  const byNumber = new Map<string, PersonView>();
  const byNameAndBirth = new Map<string, PersonView>();
  let after: string | null = null;
  do {
    const page = await deps.access.list(tx, { ...asking(input), after, limit: 500 });
    if (!page.ok) return page;
    for (const person of page.value.items) {
      byId.set(person.id, person);
      const email = lower(person.attributes['work_email']);
      if (email) byEmail.set(email, person);
      const number = lower(person.attributes['employee_number']);
      if (number) byNumber.set(number, person);
      const nb = nameAndBirth(person.attributes);
      if (nb) byNameAndBirth.set(nb, person);
    }
    after = page.value.next;
  } while (after !== null);
  return ok({ byId, byEmail, byNumber, byNameAndBirth });
}

const asking = (input: DryRunInput) => ({
  tenantId: input.tenantId,
  viewer: input.viewer,
  correlationId: input.correlationId,
  ...(input.timeZone ? { timeZone: input.timeZone } : {}),
});

export async function dryRun(
  tx: PostgresJsDatabase,
  deps: DryRunDeps,
  input: DryRunInput,
): Promise<Result<DryRun>> {
  const version = await deps.schemas.current(tx, input.tenantId);
  if (!version)
    return err(failure('SCHEMA_NOT_PUBLISHED', 'Publish a People schema before importing'));

  const unresolved = input.mapping.filter((m) => m.status === 'review' || m.status === 'refused');
  if (unresolved.length > 0) {
    return err(
      failure(
        'MAPPING_UNRESOLVED',
        'Decide every column before the dry run',
        unresolved.map((m) => m.header),
      ),
    );
  }

  const relations = await deps.relations.relations(tx, input.tenantId, input.viewer, NOBODY);
  if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR imports people'));

  // The mapping arrives from a client. Held to the same rule the mapping
  // screen applied, so a hand-edited request cannot route a column around it.
  const refused = input.mapping.filter((m) => {
    if (m.status !== 'mapped' || m.key === null || isSystemColumn(m.key)) return false;
    const definition = version.document.attributes.find((d) => d.key === m.key);
    return !definition || definition.deprecatedAt !== null || !canWrite(definition, relations).ok;
  });
  if (refused.length > 0) {
    return err(
      failure(
        'FIELD_NOT_WRITABLE',
        'Not yours to import',
        refused.map((m) => m.header),
      ),
    );
  }

  const existing = await existingPeople(tx, deps, input);
  if (!existing.ok) return existing;

  const today = deps.clock.date(input.timeZone ?? 'Etc/UTC') as string;
  const classify = rowClassifier(version, input, existing.value, relations, deps.clock, today);
  const rows = input.file.rows.map(classify);

  const counts: Record<RowOutcome, number> = {
    create: 0,
    update: 0,
    unchanged: 0,
    blocked: 0,
    duplicate: 0,
  };
  const blockedBy: Record<string, number> = {};
  const byKey: Record<string, number> = {};
  let incomplete = 0;
  for (const r of rows) {
    counts[r.outcome] += 1;
    for (const p of r.problems) {
      const label = `${p.kind === 'unknown_person' ? 'unknown' : p.kind} ${p.key}`;
      blockedBy[label] = (blockedBy[label] ?? 0) + 1;
    }
    if ((r.outcome === 'create' || r.outcome === 'update') && r.missing.length > 0) {
      incomplete += 1;
      for (const k of r.missing) byKey[k] = (byKey[k] ?? 0) + 1;
    }
  }

  return ok({
    rowsRead: rows.length,
    counts,
    blockedBy,
    incomplete: { count: incomplete, byKey },
    ignoredColumns: input.mapping.filter((m) => m.status === 'ignored').map((m) => m.header),
    effectiveFrom: input.mapping.some((m) => m.status === 'mapped' && m.key === 'effective_from')
      ? 'column'
      : 'defaults',
    rows,
    schemaVersion: version.version,
  });
}

function rowClassifier(
  version: PublishedVersion,
  input: DryRunInput,
  existing: Existing,
  relations: ViewerRelations,
  clock: Clock,
  today: string,
) {
  const definitions = version.document.attributes;
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  const mapped = input.mapping.filter((m) => m.status === 'mapped' && m.key !== null);
  const columnOf = (key: string) => mapped.find((m) => m.key === key);
  const coreRequired = CORE_IDENTITY.filter((k) => k === 'hire_date' || byKey.has(k));
  const order = input.dateOrder ?? 'iso';
  const seen = new Map<string, number>();

  return (parsed: ParsedRow): ClassifiedRow => {
    const cell = (m: ColumnMapping) => parsed.cells[m.index] ?? '';
    const problems: CellProblem[] = [];
    const values: Record<string, unknown> = {};

    for (const m of mapped) {
      const key = m.key as string;
      const definition = byKey.get(key);
      if (!definition) continue; // system columns, read below
      const raw = cell(m);
      // A sealed value exports masked; the mask is "unchanged", not a value.
      if (definition.encrypted && isMasked(raw)) continue;
      const coerced = coerceCell(definition, raw, { today, dateOrder: order });
      if (!coerced.ok)
        problems.push({ column: m.header, key, kind: 'invalid', reason: coerced.error.message });
      else if (coerced.value !== null) values[key] = coerced.value;
    }

    const dateColumn = (key: 'hire_date' | 'effective_from'): string | null => {
      const m = columnOf(key);
      if (!m) return null;
      const day = coerceDate(cell(m), order);
      if (day === undefined) {
        problems.push({
          column: m.header,
          key,
          kind: 'invalid',
          reason: `"${cell(m)}" is not a date (YYYY-MM-DD)`,
        });
        return null;
      }
      return day;
    };
    const hireDate = dateColumn('hire_date');
    const effectiveFrom = dateColumn('effective_from');

    // Who this row is about: the export's id, then work email, then employee number.
    const idColumn = columnOf(PERSON_ID_COLUMN);
    const id = idColumn ? cell(idColumn) : '';
    let person: PersonView | undefined;
    let matchedOn: ClassifiedRow['matchedOn'] = null;
    if (id !== '') {
      person = existing.byId.get(id);
      matchedOn = 'person_id';
      if (!person) {
        problems.push({
          column: idColumn?.header ?? PERSON_ID_COLUMN,
          key: PERSON_ID_COLUMN,
          kind: 'unknown_person',
          reason: 'no person with this id',
        });
      }
    } else if ((person = existing.byEmail.get(lower(values['work_email']) ?? '')))
      matchedOn = 'work_email';
    else if ((person = existing.byNumber.get(lower(values['employee_number']) ?? '')))
      matchedOn = 'employee_number';

    const base = { row: parsed.row, cells: parsed.cells, hireDate, effectiveFrom, matchedOn };

    if (problems.length > 0) {
      return {
        ...base,
        outcome: 'blocked',
        personId: person?.id ?? null,
        changes: {},
        problems,
        missing: [],
      };
    }

    if (!person) {
      for (const key of coreRequired) {
        const present = key === 'hire_date' ? hireDate !== null : values[key] !== undefined;
        if (present) continue;
        const column = columnOf(key)?.header ?? key;
        problems.push({ column, key, kind: 'missing', reason: `a new person needs ${key}` });
      }
      if (problems.length > 0) {
        return { ...base, outcome: 'blocked', personId: null, changes: {}, problems, missing: [] };
      }
    }

    // The same person twice in one file, or somebody who looks like an existing person.
    const identity = person?.id ?? lower(values['work_email']) ?? lower(values['employee_number']);
    const earlier = identity ? seen.get(identity) : undefined;
    if (identity) seen.set(identity, earlier ?? parsed.row);
    if (earlier !== undefined) {
      return {
        ...base,
        outcome: 'duplicate',
        matchedOn: 'earlier_row',
        personId: person?.id ?? null,
        changes: values,
        problems: [],
        missing: [],
      };
    }
    if (!person) {
      const lookalike = existing.byNameAndBirth.get(nameAndBirth(values) ?? '');
      if (lookalike) {
        return {
          ...base,
          outcome: 'duplicate',
          matchedOn: 'name_and_birth_date',
          personId: lookalike.id,
          changes: values,
          problems: [],
          missing: [],
        };
      }
    }

    const changes = person
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([k, v]) => !same(person.attributes[k], v) || byKey.get(k)?.encrypted,
          ),
        )
      : values;
    const merged = { ...person?.attributes, ...changes };

    const verdict = assessCompleteness(
      definitions,
      {
        legalEntityId:
          typeof merged['legal_entity_id'] === 'string' ? merged['legal_entity_id'] : null,
        country: countryOf(merged),
        employmentType: (merged['employment_type'] as EmploymentType | undefined) ?? null,
        workModel: (merged['work_model'] as WorkModel | undefined) ?? null,
        status: person ? (person.status as 'active') : 'active',
        values: merged,
        knownAttributes: new Set(byKey.keys()),
      },
      clock,
      input.timeZone,
    );
    const missing = verdict.missing
      .map((m) => m.key)
      .filter((k) => visible(byKey.get(k), relations));

    const outcome: RowOutcome = !person
      ? 'create'
      : Object.keys(changes).length > 0
        ? 'update'
        : 'unchanged';
    return { ...base, outcome, personId: person?.id ?? null, changes, problems: [], missing };
  };
}

/** A gap the importer cannot see is not theirs to be told about. */
function visible(definition: AttributeDefinition | undefined, relations: ViewerRelations): boolean {
  return definition !== undefined && visibleTo(definition, relations);
}

function countryOf(values: Readonly<Record<string, unknown>>): string | null {
  const address = values['home_address'];
  if (typeof address === 'object' && address !== null) {
    const country = (address as { country?: unknown }).country;
    if (typeof country === 'string') return country;
  }
  return typeof values['country'] === 'string' ? values['country'] : null;
}

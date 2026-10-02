import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, localDate, ok, type Clock, type Result } from '@kithena/domain-kit';
import type {
  AttributeDefinition,
  EmploymentType,
  PersonStatus,
  WorkModel,
} from '@kithena/contracts';

import { canWrite, visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import { personZone, placementOf, type TenantCalendar } from '../../domain/org/calendar.js';
import {
  personRefOf,
  placeOf,
  type FileRow,
  type Known,
} from '../../domain/import/identifiers.js';
import { assessCompleteness } from '../../domain/person/completeness.js';
import type { EmployeeNumbers } from '../org/numbering.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import type { Calendars } from '../org/org.js';
import { checkIdentifier } from '../person/identifier-review.js';
import type { PersonAccess, PersonView } from '../person/person-access.js';
import type { RelationsResolver, SchemaVersions, Viewer } from '../person/ports.js';
import { coerceCell, coerceDate, isMasked, type DateOrder } from './cells.js';
import { SYSTEM_COLUMNS, type ColumnMapping } from './mapping.js';
import {
  PERSON_ID_COLUMN,
  type ParsedFile,
  type ParsedRow,
  type RepeatingSheet,
} from './parse.js';

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

/**
 * A reference the import leaves empty, and why: a manager, legal entity or
 * work location the file names that is not in this company or this file.
 * Never blocking: the row imports without it, and HR is shown the list.
 */
export interface LeftEmpty {
  readonly row: number;
  readonly column: string;
  readonly key: string;
  readonly value: string;
  readonly reason: string;
}

/** A person reference to another row of the file, written once every row is in. */
export interface RowLink {
  readonly key: string;
  readonly row: number;
  readonly column: string;
  readonly value: string;
}

export interface ClassifiedRow {
  readonly row: number;
  readonly cells: readonly string[];
  readonly outcome: RowOutcome;
  /** The existing person for update, unchanged and duplicate rows. */
  readonly personId: string | null;
  /** Rows match people already here by work email only: identifiers are Kithena's. */
  readonly matchedOn: 'work_email' | 'name_and_birth_date' | 'earlier_row' | null;
  /** Typed values to write, by attribute key. Only what differs, for an update. */
  readonly changes: Readonly<Record<string, unknown>>;
  readonly hireDate: string | null;
  /** The row confirms an existing provisional record as hired, from `hireDate`. */
  readonly hires: boolean;
  readonly effectiveFrom: string | null;
  /**
   * An existing person's start date, changed by this row: written as a
   * correction carrying `supersedes` (§8.5), never as an overwrite.
   */
  readonly hireDateCorrection: { readonly from: string | null; readonly to: string } | null;
  /** Why it is blocked. Empty otherwise. */
  readonly problems: readonly CellProblem[];
  /** Required keys still missing once this row is written. */
  readonly missing: readonly string[];
  /** People this row points at who are other rows of the file: linked in a second pass. */
  readonly links: readonly RowLink[];
  /** References left empty, each named. */
  readonly leftEmpty: readonly LeftEmpty[];
}

/**
 * One item on a repeating attribute's sheet that will not be imported, named
 * by sheet, row and cell. It holds back that person's whole list for that
 * attribute — the sheet is the full set, so importing the rest would delete
 * it — and nothing else on their row.
 */
export interface BlockedItem {
  readonly sheet: string;
  readonly row: number;
  /** A1 reference on that sheet. */
  readonly cell: string;
  readonly key: string;
  readonly personId: string | null;
  readonly value: string;
  readonly kind: 'invalid' | 'unknown_person';
  readonly reason: string;
}

/**
 * A national identifier in a row that will import, which our checks doubt
 * (PEO-125; PRD §14.5). Listed per cell, never blocking: the row imports and
 * the value goes to HR's review. The message never repeats the value.
 */
export interface CellFinding {
  readonly row: number;
  readonly column: string;
  readonly key: string;
  readonly personId: string | null;
  readonly level: 'attention' | 'mismatch';
  readonly code: string;
  readonly message: string;
}

/** The doubted identifiers among the rows that will import. */
export function cellFindings(
  version: PublishedVersion,
  mapping: readonly ColumnMapping[],
  rows: readonly ClassifiedRow[],
): readonly CellFinding[] {
  const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
  const found: CellFinding[] = [];
  for (const r of rows) {
    if (r.outcome !== 'create' && r.outcome !== 'update') continue;
    for (const [key, value] of Object.entries(r.changes)) {
      const definition = byKey.get(key);
      const checked = definition ? checkIdentifier(definition, value) : null;
      if (!checked?.ok || checked.value === null) continue;
      const column = mapping.find((m) => m.status === 'mapped' && m.key === key)?.header ?? key;
      for (const f of checked.value.findings) {
        if (f.level === 'ok') continue;
        found.push({ row: r.row, column, key, personId: r.personId, ...f, level: f.level });
      }
    }
  }
  return found;
}

export interface DryRun {
  /** Doubted national identifiers, per cell. Imported all the same, then reviewed by HR. */
  readonly findings: readonly CellFinding[];
  readonly rowsRead: number;
  readonly counts: Readonly<Record<RowOutcome, number>>;
  /** "missing work_email" → 11, "invalid hire_date" → 3. */
  readonly blockedBy: Readonly<Record<string, number>>;
  /** Of the rows that will import (create + update), how many leave a gap, and which. */
  readonly incomplete: { readonly count: number; readonly byKey: Readonly<Record<string, number>> };
  /** Never silent: every column that will not be imported, by header. */
  readonly ignoredColumns: readonly string[];
  /**
   * The repeating attributes' sheets (§15.2), and whether each is read: one
   * for an unknown, archived, sealed or unwritable attribute is not, and is
   * listed rather than dropped.
   */
  readonly sheets: readonly {
    readonly sheet: string;
    readonly key: string;
    readonly imported: boolean;
  }[];
  readonly blockedItems: readonly BlockedItem[];
  /** Rows that correct an existing person's hire date. */
  readonly corrections: number;
  /** Whether dated facts took a file column or the defaults (§14.5). */
  readonly effectiveFrom: 'column' | 'defaults';
  /** References the rows that will import leave empty, each named. */
  readonly leftEmpty: readonly LeftEmpty[];
  /**
   * Work locations the file names that this company does not have yet, with
   * the legal entity the first row naming each sits in. An administrator's
   * run adds them before the import, which then finds them by name.
   */
  readonly newLocations: readonly { readonly name: string; readonly legalEntityId: string }[];
  readonly rows: readonly ClassifiedRow[];
  readonly schemaVersion: number;
}

export interface DryRunDeps {
  readonly access: PersonAccess;
  readonly schemas: SchemaVersions;
  readonly relations: RelationsResolver;
  readonly clock: Clock;
  /** Whose day each row's person is on (PRD §6.8). */
  readonly calendars: Calendars;
  /** Each entity's numbering (PEO-101): new people are numbered when they are hired. */
  readonly numbering?: EmployeeNumbers;
}

export interface DryRunInput {
  readonly tenantId: string;
  readonly viewer: Viewer;
  readonly correlationId: string;
  readonly file: ParsedFile;
  /** A resolved mapping: nothing left in review, nothing refused. */
  readonly mapping: readonly ColumnMapping[];
  readonly dateOrder?: DateOrder;
  /**
   * Write values that require approval straight through (PEO-077). HR's
   * alone: the write path refuses anybody else, row by row, and each row's
   * event records the keys it applied this way.
   */
  readonly applySensitiveWithoutApproval?: boolean;
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
  readonly byNameAndBirth: ReadonlyMap<string, PersonView>;
}

const fullName = (v: Readonly<Record<string, unknown>>): string | null => {
  const given = v['given_name'];
  const family = v['family_name'];
  return typeof given === 'string' && typeof family === 'string' ? `${given} ${family}` : null;
};

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
  const byNameAndBirth = new Map<string, PersonView>();
  let after: string | null = null;
  do {
    const page = await deps.access.list(tx, { ...asking(input), after, limit: 500 });
    // Nothing published yet: nobody can be read, so the plan of a company's
    // first import matches nobody. ponytail: the commit runs after setup's
    // publish and matches again, so a row for somebody already here (the
    // administrator's own record) updates them; only the plan's count says
    // "create" for it. Read records against the plan's version to count it right.
    if (!page.ok && page.error.code === 'SCHEMA_NOT_PUBLISHED' && after === null) break;
    if (!page.ok) return page;
    for (const person of page.value.items) {
      byId.set(person.id, person);
      const email = lower(person.attributes['work_email']);
      if (email) byEmail.set(email, person);
      const nb = nameAndBirth(person.attributes);
      if (nb) byNameAndBirth.set(nb, person);
    }
    after = page.value.next;
  } while (after !== null);
  return ok({ byId, byEmail, byNameAndBirth });
}

/**
 * Why an import waits for setup, and what to do: the legal entity and its
 * country pack decide which fields the law requires, so a file is read
 * against them rather than before them. Every step of an import says this.
 */
export const NOT_SET_UP =
  'Set up the employee record first: confirm the legal entity and publish its country pack. Then import, and columns that match no field become new fields for you to review.';

const asking = (input: DryRunInput) => ({
  tenantId: input.tenantId,
  viewer: input.viewer,
  correlationId: input.correlationId,
});

export async function dryRun(
  tx: PostgresJsDatabase,
  deps: DryRunDeps,
  input: DryRunInput,
): Promise<Result<DryRun>> {
  const version = await deps.schemas.current(tx, input.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', NOT_SET_UP));

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

  const calendar = await deps.calendars.load(tx, input.tenantId);
  const sheets = input.file.repeating.map((sheet) => {
    const d = version.document.attributes.find((a) => a.key === sheet.key);
    const imported =
      d !== undefined &&
      d.cardinality === 'repeating' &&
      d.deprecatedAt === null &&
      !d.encrypted &&
      canWrite(d, relations).ok;
    return { sheet: sheet.sheet, key: sheet.key, imported, source: sheet };
  });
  const items = itemsByPerson(sheets.filter((s) => s.imported).map((s) => s.source));
  const blockedItems: BlockedItem[] = [];
  const newLocations = new Map<string, { name: string; legalEntityId: string }>();
  const classify = rowClassifier(
    version,
    input,
    existing.value,
    relations,
    deps.clock,
    calendar,
    { items, blocked: blockedItems },
    newLocations,
  );
  const rows = input.file.rows.map(classify);
  // What no importable row claimed: an item whose row is blocked, a
  // duplicate, or not on the People sheet at all. An id is only a name for a
  // row of this file, so an id from another system never blocks anything else.
  for (const [personId, lists] of items.unclaimed()) {
    const known = existing.value.byId.has(personId);
    const reason =
      personId === ''
        ? 'no person id'
        : 'no row on the People sheet that will import has this person id';
    for (const [key, list] of lists) {
      for (const r of list.rows) {
        blockedItems.push({
          ...itemAt(list.sheet, r),
          key,
          personId: known ? personId : null,
          kind: 'invalid',
          reason,
        });
      }
    }
  }

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
  const tallyBlocked = (p: { readonly kind: CellProblem['kind']; readonly key: string }) => {
    const label = `${p.kind === 'unknown_person' ? 'unknown' : p.kind} ${p.key}`;
    blockedBy[label] = (blockedBy[label] ?? 0) + 1;
  };
  for (const item of blockedItems) tallyBlocked(item);
  for (const r of rows) {
    counts[r.outcome] += 1;
    for (const p of r.problems) tallyBlocked(p);
    if ((r.outcome === 'create' || r.outcome === 'update') && r.missing.length > 0) {
      incomplete += 1;
      for (const k of r.missing) byKey[k] = (byKey[k] ?? 0) + 1;
    }
  }

  return ok({
    findings: cellFindings(version, input.mapping, rows),
    rowsRead: rows.length,
    counts,
    blockedBy,
    incomplete: { count: incomplete, byKey },
    ignoredColumns: input.mapping.filter((m) => m.status === 'ignored').map((m) => m.header),
    sheets: sheets.map(({ sheet, key, imported }) => ({ sheet, key, imported })),
    blockedItems,
    corrections: rows.filter((r) => r.outcome === 'update' && r.hireDateCorrection).length,
    effectiveFrom: input.mapping.some((m) => m.status === 'mapped' && m.key === 'effective_from')
      ? 'column'
      : 'defaults',
    leftEmpty: rows
      .filter((r) => r.outcome === 'create' || r.outcome === 'update' || r.outcome === 'unchanged')
      .flatMap((r) => r.leftEmpty),
    newLocations: [...newLocations.values()],
    rows,
    schemaVersion: version.version,
  });
}

/** Kinds of value that point at something in the company rather than holding a value. */
const REFERENCES: ReadonlySet<string> = new Set(['person_ref', 'legal_entity_ref', 'location_ref']);

/**
 * Each row as a reference to a person can name it: its id where it came from
 * (the person id column, else the employee number), its work email, its name.
 */
function fileRowsOf(input: DryRunInput): FileRow[] {
  const at = (key: string, mappedOnly: boolean) =>
    input.mapping.find((m) => m.key === key && (!mappedOnly || m.status === 'mapped'))?.index;
  const idAt = at(PERSON_ID_COLUMN, false) ?? at('employee_number', false);
  const emailAt = at('work_email', true);
  const givenAt = at('given_name', true);
  const familyAt = at('family_name', true);
  const text = (r: ParsedRow, i: number | undefined) => {
    const v = i === undefined ? '' : (r.cells[i] ?? '').trim();
    return v === '' ? null : v;
  };
  return input.file.rows.map((r) => {
    const given = text(r, givenAt);
    const family = text(r, familyAt);
    return {
      row: r.row,
      fileId: text(r, idAt),
      email: text(r, emailAt),
      name: given !== null && family !== null ? `${given} ${family}` : null,
    };
  });
}

function rowClassifier(
  version: PublishedVersion,
  input: DryRunInput,
  existing: Existing,
  relations: ViewerRelations,
  clock: Clock,
  calendar: TenantCalendar,
  repeating: { readonly items: ItemsByPerson; readonly blocked: BlockedItem[] },
  newLocations: Map<string, { name: string; legalEntityId: string }>,
) {
  const at = clock.instant();
  const definitions = version.document.attributes;
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  const mapped = input.mapping.filter((m) => m.status === 'mapped' && m.key !== null);
  const columnOf = (key: string) => mapped.find((m) => m.key === key);
  const coreRequired = CORE_IDENTITY.filter((k) => k === 'hire_date' || byKey.has(k));
  const live = [...calendar.entities.values()].filter((e) => e.archived !== true);
  const onlyEntity = live.length === 1 ? (live[0]?.id ?? null) : null;
  const order = input.dateOrder ?? 'iso';
  const seen = new Map<string, number>();

  // References are resolved against this company and this file, never copied.
  const fileRows = fileRowsOf(input);
  const fileIdOf = new Map(fileRows.map((r) => [r.row, r.fileId]));
  const known: Known[] = [...existing.byId.values()].map((p) => ({
    id: p.id,
    email: lower(p.attributes['work_email']),
    name: fullName(p.attributes),
  }));
  // A row of the file that is somebody already here: a reference to it is to them.
  const hereByRow = new Map(
    fileRows.flatMap((r) => {
      const p = existing.byEmail.get(lower(r.email) ?? '');
      return p ? [[r.row, p.id] as const] : [];
    }),
  );
  const entities = [...calendar.entities.values()];
  const locations = [...calendar.locations.values()];

  return (parsed: ParsedRow): ClassifiedRow => {
    const cell = (m: ColumnMapping) => parsed.cells[m.index] ?? '';
    const coerceRow = (today: string) => {
      const found: CellProblem[] = [];
      const coerced: Record<string, unknown> = {};
      for (const m of mapped) {
        const key = m.key as string;
        const definition = byKey.get(key);
        // System columns are read below, the hire date among them even when
        // it is a published field: it is hired or corrected, never written
        // as a profile value. References are resolved below, never copied.
        if (!definition || key === 'hire_date' || REFERENCES.has(definition.typeConfig.kind)) {
          continue;
        }
        const raw = cell(m);
        // A sealed value exports masked; the mask is "unchanged", not a value.
        if (definition.encrypted && isMasked(raw)) continue;
        const one = coerceCell(definition, raw, { today, dateOrder: order });
        if (!one.ok)
          found.push({ column: m.header, key, kind: 'invalid', reason: one.error.message });
        else if (one.value !== null) coerced[key] = one.value;
      }
      return { found, coerced };
    };

    /*
     * A date's "past" or "future" is judged on the person's own day (PRD
     * §6.8), and which person — and so which calendar — is only known once
     * the row's entity, location and work email are read. So: read on the
     * tenant's day, work out whose day it really is, and read again on that
     * day if it differs. The placement cells are references, which no day
     * changes.
     */
    const tenantDay = localDate(at, calendar.defaultZone);
    const first = coerceRow(tenantDay);
    // Who this row is about: somebody here with its work email, or nobody yet.
    // Identifiers are Kithena's: a person id or employee number never matches.
    const person: PersonView | undefined = existing.byEmail.get(
      lower(first.coerced['work_email']) ?? '',
    );
    const matchedOn: ClassifiedRow['matchedOn'] = person ? 'work_email' : null;

    // Its references: to somebody or something here, to another row, or left empty.
    const refs: Record<string, unknown> = {};
    const links: RowLink[] = [];
    const leftEmpty: LeftEmpty[] = [];
    const resolve = (kinds: readonly string[]) => {
      for (const m of mapped) {
        const key = m.key as string;
        const kind = byKey.get(key)?.typeConfig.kind;
        const raw = cell(m).trim();
        if (kind === undefined || !kinds.includes(kind) || raw === '') continue;
        const empty = (reason: string) =>
          leftEmpty.push({ row: parsed.row, column: m.header, key, value: raw, reason });
        if (kind === 'person_ref') {
          const ref = personRefOf(raw, { rows: fileRows, people: known, self: parsed.row });
          const here = ref.kind === 'row' ? hereByRow.get(ref.row) : undefined;
          if (ref.kind === 'person') refs[key] = ref.id;
          else if (here !== undefined) refs[key] = here;
          else if (ref.kind === 'row') {
            links.push({ key, row: ref.row, column: m.header, value: raw });
          } else empty(ref.reason);
        } else if (kind === 'legal_entity_ref') {
          const ref = placeOf(raw, entities);
          if (ref.kind === 'id') refs[key] = ref.id;
          // A company with one legal entity has one answer (PEO-123), whatever the file says.
          else if (onlyEntity !== null) refs[key] = onlyEntity;
          else {
            empty(ref.kind === 'new' ? `no legal entity here is called “${ref.name}”` : ref.reason);
          }
        } else {
          const ref = placeOf(raw, locations);
          if (ref.kind === 'id') {
            refs[key] = ref.id;
            continue;
          }
          if (ref.kind === 'none') {
            empty(ref.reason);
            continue;
          }
          const entity =
            refs['legal_entity_id'] ?? person?.attributes['legal_entity_id'] ?? onlyEntity;
          if (typeof entity !== 'string') {
            empty(
              `no work location here is called “${ref.name}”, and the row has no legal entity to add it to`,
            );
            continue;
          }
          // An administrator's run adds it before the import, which then finds it by name.
          const wanted = ref.name.toLocaleLowerCase('en');
          // Not yet a value: the plan says it is added, or, for HR, that it is not.
          if (!newLocations.has(wanted)) {
            newLocations.set(wanted, { name: ref.name, legalEntityId: entity });
          }
        }
      }
    };
    resolve(['person_ref', 'legal_entity_ref']);
    resolve(['location_ref']);

    const zone = personZone(
      calendar,
      placementOf({ ...person?.attributes, ...first.coerced, ...refs }),
      at,
    );
    const personDay = localDate(at, zone);
    const read = personDay === tenantDay ? first : coerceRow(personDay);
    const problems = read.found;
    const values: Record<string, unknown> = { ...read.coerced, ...refs };

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
    let hireDate = dateColumn('hire_date');
    const effectiveFrom = dateColumn('effective_from');
    // A hire needs a work email (§8.2): without one the person is created
    // provisional, and the start date waits with HR.
    if (!person && values['work_email'] === undefined && hireDate !== null) {
      const m = columnOf('hire_date');
      leftEmpty.push({
        row: parsed.row,
        column: m?.header ?? 'hire_date',
        key: 'hire_date',
        value: hireDate,
        reason: 'not hired yet: a hire needs a work email, so HR sets both',
      });
      hireDate = null;
    }

    const hires = person?.status === 'provisional' && hireDate !== null;

    // An existing person's start date is a fact already recorded, so a new
    // one is a correction of it (§8.5): typed, carrying `supersedes`, through
    // the one correction path, and refused here when that path would refuse.
    let hireDateCorrection: ClassifiedRow['hireDateCorrection'] = null;
    if (person && !hires && hireDate !== null) {
      const held = person.attributes['hire_date'];
      const hireDefinition = byKey.get('hire_date');
      if (!hireDefinition || !canWrite(hireDefinition, relations).ok) {
        problems.push({
          column: columnOf('hire_date')?.header ?? 'hire_date',
          key: 'hire_date',
          kind: 'invalid',
          reason:
            "an existing person's hire date changes only by a correction, and hire date is not a field you may correct",
        });
      } else if (held !== hireDate) {
        hireDateCorrection = { from: typeof held === 'string' ? held : null, to: hireDate };
      }
    }

    const base = {
      row: parsed.row,
      cells: parsed.cells,
      hireDate,
      hires,
      hireDateCorrection,
      effectiveFrom,
      matchedOn,
      links,
      leftEmpty,
    };

    // Nothing blocks a row: a cell that cannot be read is left empty, and
    // listed for HR with why. The rest of the row imports.
    for (const p of problems) {
      const m = mapped.find((x) => x.header === p.column);
      leftEmpty.push({
        row: parsed.row,
        column: p.column,
        key: p.key,
        value: m ? cell(m).trim() : '',
        reason: p.reason,
      });
    }

    if (!person) {
      // A company with one legal entity has one answer to "which entity"
      // (PEO-123): a new person's missing cell takes it rather than blocking.
      if (
        onlyEntity !== null &&
        byKey.has('legal_entity_id') &&
        values['legal_entity_id'] === undefined
      ) {
        values['legal_entity_id'] = onlyEntity;
      }
      // Skipped only when the row cannot be anybody: no name and no work email.
      const has = (key: string) => values[key] !== undefined;
      if (!has('given_name') && !has('family_name') && !has('work_email')) {
        const nobody: CellProblem = {
          column: columnOf('work_email')?.header ?? 'work_email',
          key: 'work_email',
          kind: 'missing',
          reason: 'no name and no work email: nobody to create',
        };
        return { ...base, outcome: 'blocked', personId: null, changes: {}, problems: [nobody], missing: [] };
      }
      // Anybody else is created; without a start date they stay provisional until HR hires them.
      if (
        coreRequired.includes('hire_date') &&
        hireDate === null &&
        !leftEmpty.some((l) => l.key === 'hire_date')
      ) {
        const m = columnOf('hire_date');
        leftEmpty.push({
          row: parsed.row,
          column: m?.header ?? 'hire_date',
          key: 'hire_date',
          value: m ? cell(m).trim() : '',
          reason: 'no start date: added as provisional until HR sets one',
        });
      }
    }

    // The same person twice in one file, or somebody who looks like an existing person.
    const identity = person?.id ?? lower(values['work_email']);
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

    // The repeating sheets' lists for this row, keyed by its id in the file
    // (only a name for the row: another Kithena's id finds its own row's
    // lists, for a new person as for one already here). Each whole, or not at all.
    const claimedBy = fileIdOf.get(parsed.row) ?? person?.id;
    if (claimedBy !== undefined) {
      for (const [key, list] of repeating.items.claim(claimedBy)) {
        const definition = byKey.get(key);
        if (!definition) continue;
        const listed = readList(definition, list, { today: personDay, dateOrder: order });
        if (listed.ok) values[key] = listed.value;
        else {
          repeating.blocked.push(
            ...listed.error.map((b) => ({ ...b, personId: person?.id ?? null })),
          );
        }
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

    // The state the commit leaves the row in, so a pre-hire is asked only for
    // what a pre-hire is asked for (§8.1): a hire, of a new person or a
    // provisional one, is active from its start date on the person's day.
    const statusAfter = (
      !person || hires
        ? hireDate !== null && hireDate > personDay
          ? 'pre_hire'
          : 'active'
        : person.status
    ) as PersonStatus;
    const verdict = assessCompleteness(
      definitions,
      {
        legalEntityId:
          typeof merged['legal_entity_id'] === 'string' ? merged['legal_entity_id'] : null,
        country: countryOf(merged),
        employmentType: (merged['employment_type'] as EmploymentType | undefined) ?? null,
        workModel: (merged['work_model'] as WorkModel | undefined) ?? null,
        status: statusAfter,
        values: merged,
        knownAttributes: new Set(byKey.keys()),
      },
      clock,
      zone,
    );
    const missing = verdict.missing
      .map((m) => m.key)
      .filter((k) => visible(byKey.get(k), relations));

    const outcome: RowOutcome = !person
      ? 'create'
      : Object.keys(changes).length > 0 || hires || hireDateCorrection
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

/* ------------------------------------------------------ repeating sheets -- */

interface ItemList {
  readonly sheet: string;
  readonly rows: readonly ParsedRow[];
}

interface ItemsByPerson {
  /** This person's lists by attribute key, handed out once. */
  claim(personId: string): ReadonlyMap<string, ItemList>;
  /** What nobody claimed, by person id ('' for rows with none). */
  unclaimed(): Iterable<[string, ReadonlyMap<string, ItemList>]>;
}

/** Every item row, grouped by the person id in its first cell. */
function itemsByPerson(sheets: readonly RepeatingSheet[]): ItemsByPerson {
  const byPerson = new Map<string, Map<string, { sheet: string; rows: ParsedRow[] }>>();
  for (const sheet of sheets) {
    for (const r of sheet.rows) {
      const id = r.cells[0] ?? '';
      const lists = byPerson.get(id) ?? new Map<string, { sheet: string; rows: ParsedRow[] }>();
      const list = lists.get(sheet.key) ?? { sheet: sheet.sheet, rows: [] };
      list.rows.push(r);
      lists.set(sheet.key, list);
      byPerson.set(id, lists);
    }
  }
  return {
    claim(personId) {
      const lists = byPerson.get(personId) ?? new Map<string, ItemList>();
      byPerson.delete(personId);
      return lists;
    },
    unclaimed: () => byPerson.entries(),
  };
}

/** The item is the fourth column: person id, employee number, #, item. */
const ITEM = 3;

const itemAt = (sheet: string, r: ParsedRow) => ({
  sheet,
  row: r.row,
  cell: `D${String(r.row)}`,
  value: r.cells[ITEM] ?? '',
});

/**
 * One person's list from its sheet, in sheet order: each item held to the
 * attribute's type exactly as a single cell would be, or every bad one named.
 * An empty item cell is not an item.
 */
function readList(
  definition: AttributeDefinition,
  list: ItemList,
  ctx: { readonly today: string; readonly dateOrder: DateOrder },
): Result<unknown[], Omit<BlockedItem, 'personId'>[]> {
  const one: AttributeDefinition = { ...definition, cardinality: 'single' };
  const values: unknown[] = [];
  const bad: Omit<BlockedItem, 'personId'>[] = [];
  for (const r of list.rows) {
    const raw = r.cells[ITEM] ?? '';
    if (raw === '') continue;
    const read = coerceCell(one, raw, ctx);
    if (read.ok) values.push(read.value);
    else {
      bad.push({
        ...itemAt(list.sheet, r),
        key: definition.key,
        kind: 'invalid',
        reason: read.error.message,
      });
    }
  }
  return bad.length > 0 ? err(bad) : ok(values);
}

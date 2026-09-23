import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import ExcelJS from 'exceljs';
import { err, failure, localDate, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import { exponentOf, fromMinor, MASK } from '../import/cells.js';
import { writeCsv } from '../import/csv.js';
import { judge, NOTHING_JUDGED, versionInForce, type Judgement, type RecordDeps } from './as-of.js';
import { PERSON_ID_COLUMN } from '../import/parse.js';
import type { Calendars } from '../org/org.js';
import type { Asking, PersonAccess, PersonView, SealedValue } from '../person/person-access.js';
import type { RelationsResolver, SchemaVersions } from '../person/ports.js';

/**
 * CSV and XLSX exports of the directory (PRD §15.2, §15.4).
 *
 * **An export is a read.** Every row comes from `PersonAccess.list`, so every
 * cell is one this viewer may read, and a column exists only when the viewer
 * may read that field on somebody in the file. A manager exporting their team
 * gets a manager's columns; there is no path here that reads around it.
 *
 * **Columns come from the published schema at export time**, in section
 * order and then attribute order — the order of the profile screen — with
 * **two header rows**: the label people read, then the stable key the
 * re-importer maps by. That second row is what makes a relabelled field
 * round-trip. The first column is the person's id, hidden in XLSX, so a
 * re-import updates rather than duplicates even after somebody edits a name.
 *
 * Special-category attributes never appear (§15.2: they are the DSAR path's,
 * run as the subject), and neither does anything marked not exportable.
 * Sealed values export masked. Repeating attributes get their own sheet, or
 * their own file in CSV, never `contact_1_name … contact_4_email`.
 */

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportRequest extends Asking {
  readonly format: ExportFormat;
  /** Attribute keys, or every readable field when absent. */
  readonly fields?: readonly string[];
  /** A past date replays history; absent is today. */
  readonly asOf?: string;
  readonly includeArchived?: boolean;
  /** A selection. Absent is everybody the viewer may list. */
  readonly personIds?: readonly string[];
  /** How the requester described who, for the provenance sheet. */
  readonly filter?: string;
}

export interface ExportFile {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface BuiltExport {
  readonly files: readonly ExportFile[];
  /** The columns actually exported — what the audit event names. */
  readonly attributeKeys: readonly string[];
  readonly rowCount: number;
  readonly schemaVersion: number;
}

export interface ExportDeps {
  readonly access: PersonAccess;
  readonly schemas: SchemaVersions;
  readonly relations: RelationsResolver;
  readonly clock: Clock;
  /** The raw record and its history, for judging completeness on the export's day. */
  readonly records: RecordDeps;
  /** The tenant's calendar, for the file's date. */
  readonly calendars: Calendars;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const AMBER = 'FFFFC000';
const GREY = 'FFD9D9D9';
const PAGE = 500;

/** The columns a standard export may ever carry, in profile order. */
export function exportableColumns(
  version: PublishedVersion,
  includeArchived = false,
): readonly AttributeDefinition[] {
  const sectionOrder = new Map(version.document.sections.map((s) => [s.key as string, s.order]));
  return version.document.attributes
    .filter((d) => d.classification.classification !== 'special-category')
    .filter((d) => d.classification.exportable)
    .filter((d) => includeArchived || d.deprecatedAt === null)
    .toSorted(
      (a, b) =>
        (sectionOrder.get(a.sectionKey) ?? 0) - (sectionOrder.get(b.sectionKey) ?? 0) ||
        a.order - b.order,
    );
}

interface Row {
  readonly person: PersonView;
  readonly judged: Judgement;
}

/**
 * Sealed values to put in the file in full, for an approved request only
 * (`full-values.ts`). Read cell by cell while the file is built and dropped
 * with it: never cached, never logged, never returned anywhere but the file.
 */
export interface Reveal {
  readonly keys: ReadonlySet<string>;
  readonly value: (
    tx: PostgresJsDatabase,
    where: { tenantId: string; personId: string; attributeKey: string },
  ) => Promise<string | null>;
}

export async function buildExport(
  tx: PostgresJsDatabase,
  deps: ExportDeps,
  request: ExportRequest,
  reveal?: Reveal,
): Promise<Result<BuiltExport>> {
  const version = await deps.schemas.current(tx, request.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published to export'));

  const candidates = exportableColumns(version, request.includeArchived);
  if (request.fields) {
    const known = new Set(candidates.map((d) => d.key as string));
    const refused = request.fields.filter((k) => !known.has(k));
    if (refused.length > 0) {
      // Special-category, not exportable, archived or unknown: one refusal,
      // so a probe cannot tell which.
      return err(failure('EXPORT_FIELD_REFUSED', `Not exportable: ${refused.join(', ')}`, refused));
    }
  }
  const wanted = request.fields ? new Set(request.fields) : null;

  // A tenant-wide file, so the tenant's day (PRD §6.8): one date for
  // everybody on it — the file's stamp, its "As of", and the day its gaps are
  // judged on.
  const calendar = await deps.calendars.load(tx, request.tenantId);
  const stamp = localDate(deps.clock.instant(), calendar.defaultZone);

  // Completeness is judged on the export's day, against the version in force
  // then: an `asOf` export is a picture of that day, its gaps included.
  const day = request.asOf ?? stamp;
  const judgedBy = request.asOf
    ? await versionInForce(tx, deps.schemas, request.tenantId, request.asOf, calendar.defaultZone)
    : version;
  const requested = candidates.filter((d) => !wanted || wanted.has(d.key));

  // Every row through the read path, and the columns this viewer may read on
  // at least one of them.
  const selection = request.personIds ? new Set(request.personIds) : null;
  const readableKeys = new Set<string>();
  const rows: Row[] = [];
  let after: string | null = null;
  do {
    const page = await deps.access.list(tx, {
      ...request,
      after,
      limit: PAGE,
      ...(request.asOf ? { asOf: request.asOf } : {}),
    });
    if (!page.ok) return page;
    for (const person of page.value.items) {
      if (selection && !selection.has(person.id)) continue;
      const relations = await deps.relations.relations(
        tx,
        request.tenantId,
        request.viewer,
        person.id,
      );
      for (const d of requested) if (visibleTo(d, relations)) readableKeys.add(d.key);
      const judged = judgedBy
        ? await judge(
            tx,
            deps.records,
            {
              tenantId: request.tenantId,
              personId: person.id,
              day,
              asOf: request.asOf !== undefined,
            },
            judgedBy,
            relations,
          )
        : NOTHING_JUDGED;
      rows.push({ person, judged });
    }
    after = page.value.next;
  } while (after !== null);

  const columns = requested.filter((d) => readableKeys.has(d.key));
  if (reveal) {
    const unsealed = columns.filter((d) => d.encrypted && reveal.keys.has(d.key));
    for (const [i, r] of rows.entries()) {
      const attributes = { ...r.person.attributes };
      for (const d of unsealed) {
        if (!isSealed(attributes[d.key])) continue;
        attributes[d.key] = await reveal.value(tx, {
          tenantId: request.tenantId,
          personId: r.person.id,
          attributeKey: d.key,
        });
      }
      rows[i] = { ...r, person: { ...r.person, attributes } };
    }
  }
  const flat = columns.filter((d) => d.cardinality !== 'repeating');
  const repeating = columns.filter((d) => d.cardinality === 'repeating');

  const files =
    request.format === 'csv'
      ? csvFiles(flat, repeating, rows, stamp)
      : [
          {
            name: `people-${stamp}.xlsx`,
            mediaType: XLSX_TYPE,
            bytes: await workbook(
              flat,
              repeating,
              rows,
              version,
              judgedBy,
              request,
              deps.clock,
              columns,
              stamp,
            ),
          },
        ];

  return ok({
    files,
    attributeKeys: columns.map((d) => d.key),
    rowCount: rows.length,
    schemaVersion: version.version,
  });
}

/* ----------------------------------------------------------------- cells -- */

const isSealed = (v: unknown): v is SealedValue =>
  typeof v === 'object' && v !== null && 'last4' in v && Object.keys(v).length === 1;
const isMoney = (v: unknown): v is { amountMinor: number; currency: string } =>
  typeof v === 'object' && v !== null && 'amountMinor' in v && 'currency' in v;

/** "•••• 2291": what a sealed value is outside its audited path. */
export const masked = (v: SealedValue): string =>
  v.last4 === null ? MASK.repeat(4) : `${MASK.repeat(4)} ${v.last4}`;

function optionLabel(d: AttributeDefinition, value: unknown): string {
  if (d.typeConfig.kind !== 'select' && d.typeConfig.kind !== 'multi_select') return String(value);
  return d.typeConfig.options.find((o) => o.value === value)?.label.default ?? String(value);
}

/** The text a cell carries in CSV, which the importer reads back to the same value. */
export function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (isSealed(value)) return masked(value);
  if (isMoney(value)) return `${fromMinor(value.amountMinor, value.currency)} ${value.currency}`;
  if (Array.isArray(value)) return value.map((v) => text(v)).join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** A real cell: money as a number with a currency format, dates as dates. */
function xlsxCell(cell: ExcelJS.Cell, d: AttributeDefinition, value: unknown): void {
  if (value === undefined || value === null) return;
  if (isMoney(value)) {
    // Minor units moved into a decimal string, then a number: exact for any
    // salary below 2^53 minor units, and a number is what SUM reads.
    cell.value = Number(fromMinor(value.amountMinor, value.currency));
    const decimals = exponentOf(value.currency) ?? 2;
    cell.numFmt = `[$${value.currency}] #,##0${decimals > 0 ? `.${'0'.repeat(decimals)}` : ''}`;
    return;
  }
  if (d.typeConfig.kind === 'date' && typeof value === 'string') {
    cell.value = new Date(`${value}T00:00:00.000Z`);
    cell.numFmt = 'yyyy-mm-dd';
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    cell.value = value;
    return;
  }
  if (d.typeConfig.kind === 'select') {
    cell.value = optionLabel(d, value);
    return;
  }
  // A string cell, never a formula: exceljs writes `=…` text as text.
  cell.value = text(value);
}

const isBlank = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/* ------------------------------------------------------------------- csv -- */

const MISSING_COLUMN = '__missing_required';

function csvFiles(
  flat: readonly AttributeDefinition[],
  repeating: readonly AttributeDefinition[],
  rows: readonly Row[],
  stamp: string,
): ExportFile[] {
  const main = [
    ['Person id', ...flat.map(label), MISSING_COLUMN],
    [PERSON_ID_COLUMN, ...flat.map((d) => d.key as string), MISSING_COLUMN],
    ...rows.map((r) => [
      r.person.id,
      ...flat.map((d) => text(r.person.attributes[d.key])),
      [...r.judged.missing.keys()].filter((k) => flat.some((d) => d.key === k)).join(','),
    ]),
  ];
  const files: ExportFile[] = [
    { name: `people-${stamp}.csv`, mediaType: 'text/csv', bytes: writeCsv(main) },
  ];
  for (const d of repeating) {
    files.push({
      name: `people-${stamp}-${d.key}.csv`,
      mediaType: 'text/csv',
      bytes: writeCsv(repeatingRows(d, rows).map((r) => r.map((c) => text(c)))),
    });
  }
  return files;
}

function label(d: AttributeDefinition): string {
  return d.deprecatedAt === null ? d.label.default : `${d.label.default} (archived)`;
}

/** One row per entry, keyed back to its person. */
function repeatingRows(d: AttributeDefinition, rows: readonly Row[]): unknown[][] {
  const out: unknown[][] = [['Person id', 'Employee number', '#', label(d)]];
  for (const r of rows) {
    const entries = r.person.attributes[d.key];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, i) => {
      out.push([r.person.id, r.person.attributes['employee_number'] ?? '', String(i + 1), entry]);
    });
  }
  return out;
}

/* ------------------------------------------------------------------ xlsx -- */

/** A sheet name: at most 31 characters and none of `[]:*?/\`. */
const sheetName = (s: string) => s.replaceAll(/[[\]:*?/\\]/gu, ' ').slice(0, 31);

async function workbook(
  flat: readonly AttributeDefinition[],
  repeating: readonly AttributeDefinition[],
  rows: readonly Row[],
  version: PublishedVersion,
  judgedBy: PublishedVersion | null,
  request: ExportRequest,
  clock: Clock,
  columns: readonly AttributeDefinition[],
  today: string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const people = wb.addWorksheet('People', { views: [{ state: 'frozen', ySplit: 2 }] });
  const lists = wb.addWorksheet('Lists', { state: 'veryHidden' });

  people.addRow(['Person id', ...flat.map(label)]).font = { bold: true };
  people.addRow([PERSON_ID_COLUMN, ...flat.map((d) => d.key as string)]);
  people.getColumn(1).hidden = true;

  // Option lists, one column each on a sheet nobody sees, so a dropdown is
  // not bounded by the 255 characters an inline list may hold.
  const validation = new Map<string, string>();
  flat.forEach((d) => {
    if (d.typeConfig.kind !== 'select') return;
    const live = d.typeConfig.options
      .filter((o) => o.retiredAt === null)
      .map((o) => o.label.default);
    const col = lists.getColumn(validation.size + 1);
    col.values = [undefined, ...live];
    validation.set(
      d.key,
      `Lists!$${col.letter}$1:$${col.letter}$${String(Math.max(live.length, 1))}`,
    );
  });

  const missingSheet: unknown[][] = [['Person id', 'Employee number', 'Field', 'Key', 'Owned by']];
  for (const r of rows) {
    const row = people.addRow([r.person.id]);
    flat.forEach((d, i) => {
      const cell = row.getCell(i + 2);
      xlsxCell(cell, d, r.person.attributes[d.key]);
      const formula = validation.get(d.key);
      if (formula) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [formula] };
      if (r.judged.missing.has(d.key)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
        cell.note = `Missing: ${d.label.default} is required`;
      } else if (r.judged.notApplicable.has(d.key) && isBlank(r.person.attributes[d.key])) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
        cell.note = 'not required for this person';
      }
    });
    // Every gap on the day, not only the ones with a column today: a field
    // required in March and archived since is still a gap in March.
    for (const d of r.judged.missing.values()) {
      missingSheet.push([
        r.person.id,
        r.person.attributes['employee_number'] ?? '',
        d.label.default,
        d.key,
        d.ownership.join(', '),
      ]);
    }
  }

  for (const d of repeating) {
    const sheet = wb.addWorksheet(sheetName(label(d)));
    for (const values of repeatingRows(d, rows)) {
      const row = sheet.addRow(values.slice(0, 3));
      if (values[3] !== undefined) xlsxCell(row.getCell(4), d, values[3]);
    }
  }

  const missing = wb.addWorksheet('Missing information');
  for (const values of missingSheet) missing.addRow(values);

  const about = wb.addWorksheet('About this export');
  for (const line of [
    ['Schema version', version.version],
    ['As of', request.asOf ?? today],
    [
      'Filter',
      request.filter ??
        (request.personIds
          ? `${String(request.personIds.length)} selected people`
          : 'Everyone you can see'),
    ],
    ['Fields', columns.map((d) => d.key).join(', ')],
    ['Exported by', request.viewer.accountId],
    ['Exported at', clock.instant()],
    ['Rows', rows.length],
    [
      'Missing information judged against schema version',
      judgedBy?.version ?? 'none published then',
    ],
  ]) {
    about.addRow(line);
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

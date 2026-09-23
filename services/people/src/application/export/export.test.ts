import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import FormulaParser from 'fast-formula-parser';

import { commitImport } from '../import/commit.js';
import { commitDeps } from '../import/fixture.js';
import { proposeMapping, resolveMapping } from '../import/mapping.js';
import { parseUpload } from '../import/parse.js';
import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { buildExport, type ExportRequest } from './export.js';
import { ADA, asking, financeTenant, HR, MANAGER, MARCO } from './fixture.js';

const HR_RELATIONS = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};

async function exported(
  viewer: Viewer,
  over: Partial<ExportRequest> = {},
  store = financeTenant(),
) {
  const deps = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    relations: store.deps.relations,
    records: store.deps,
    clock: store.deps.clock,
  };
  const result = await buildExport(tx, deps, { ...asking(viewer), format: 'xlsx', ...over });
  if (!result.ok) throw new Error(result.error.message);
  return { ...result.value, store };
}

async function open(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as never);
  return wb;
}

const rowValues = (sheet: ExcelJS.Worksheet, n: number) =>
  (sheet.getRow(n).values as unknown[]).slice(1);

describe('the XLSX register', () => {
  it('has label then key, in profile order, with no special-category column and the id hidden', async () => {
    const { files, attributeKeys } = await exported(HR);
    const wb = await open(files[0]?.bytes ?? new Uint8Array());
    const people = wb.getWorksheet('People');
    if (!people) throw new Error('no People sheet');

    expect(rowValues(people, 1)).toEqual([
      'Person id',
      'Given name',
      'Family name',
      'Date of birth',
      'Employee number',
      'Job title',
      'Base salary',
      'Level',
      'Cost centre',
      'IBAN',
    ]);
    expect(rowValues(people, 2)[0]).toBe('__person_id');
    expect(rowValues(people, 2)).toContain('base_salary');
    expect(attributeKeys).not.toContain('health_notes');
    expect(JSON.stringify(rowValues(people, 3))).not.toContain('never exported');
    expect(people.getColumn(1).hidden).toBe(true);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'People',
      'Lists',
      'Languages',
      'Missing information',
      'About this export',
    ]);
  });

  it('writes salary as a currency-formatted number that sums in a spreadsheet engine', async () => {
    const { files } = await exported(HR);
    const wb = await open(files[0]?.bytes ?? new Uint8Array());
    const people = wb.getWorksheet('People');
    if (!people) throw new Error('no People sheet');
    const col = (rowValues(people, 2) as string[]).indexOf('base_salary') + 1;
    const salary = people.getRow(3).getCell(col);
    expect(typeof salary.value).toBe('number');
    expect(salary.numFmt).toBe('[$EUR] #,##0.00');

    const engine = new FormulaParser({
      onCell: ({ row, col: c }) => people.getRow(row).getCell(c).value,
      onRange: ({ from, to }) => {
        const out: unknown[][] = [];
        for (let r = from.row; r <= to.row; r++) {
          const line: unknown[] = [];
          for (let c = from.col; c <= to.col; c++) line.push(people.getRow(r).getCell(c).value);
          out.push(line);
        }
        return out;
      },
    });
    const letter = people.getColumn(col).letter;
    // 90,000.00 + 60,000.50 + 55,000.25, to the cent. SUM skips text, so a
    // column of strings would sum to 0.
    expect(engine.parse(`SUM(${letter}3:${letter}5)`, { sheet: 'People', row: 1, col: 1 })).toBe(
      205_000.75,
    );
  });

  it('writes dates as dates, options as a dropdown, and a sealed value masked', async () => {
    const { files } = await exported(HR);
    const wb = await open(files[0]?.bytes ?? new Uint8Array());
    const people = wb.getWorksheet('People');
    if (!people) throw new Error('no People sheet');
    const keys = rowValues(people, 2) as string[];
    const ada = [3, 4, 5].map((r) => people.getRow(r)).find((r) => r.getCell(1).value === ADA);
    if (!ada) throw new Error('no Ada');

    expect(ada.getCell(keys.indexOf('date_of_birth') + 1).value).toEqual(
      new Date('1990-04-03T00:00:00.000Z'),
    );
    const level = ada.getCell(keys.indexOf('level') + 1);
    expect(level.value).toBe('Senior');
    expect(level.dataValidation).toMatchObject({ type: 'list', formulae: ['Lists!$A$1:$A$2'] });
    expect(ada.getCell(keys.indexOf('iban') + 1).value).toBe('•••• 1332');
    // Text, never a formula, whatever it starts with.
    expect(ada.getCell(keys.indexOf('job_title') + 1).type).toBe(ExcelJS.ValueType.String);
  });

  it('marks a missing required value amber, with a note, and lists it', async () => {
    const { files } = await exported(HR);
    const wb = await open(files[0]?.bytes ?? new Uint8Array());
    const people = wb.getWorksheet('People');
    if (!people) throw new Error('no People sheet');
    const col = (rowValues(people, 2) as string[]).indexOf('cost_centre') + 1;
    const marco = [3, 4, 5].map((r) => people.getRow(r)).find((r) => r.getCell(1).value === MARCO);
    const cell = marco?.getCell(col);
    expect(cell?.value).toBeNull();
    expect(cell?.fill).toMatchObject({ pattern: 'solid', fgColor: { argb: 'FFFFC000' } });
    expect(JSON.stringify(cell?.note)).toContain('Cost centre');

    const missing = wb.getWorksheet('Missing information');
    expect(missing?.rowCount).toBe(2);
    expect(missing && rowValues(missing, 2)).toEqual([
      MARCO,
      'E-Marco',
      'Cost centre',
      'cost_centre',
      'hr',
    ]);
  });

  it('puts a repeating attribute on its own sheet, keyed by person', async () => {
    const { files } = await exported(HR);
    const wb = await open(files[0]?.bytes ?? new Uint8Array());
    const people = wb.getWorksheet('People');
    expect(
      people && (rowValues(people, 2) as string[]).some((k) => k.startsWith('languages')),
    ).toBe(false);
    const languages = wb.getWorksheet('Languages');
    expect(languages && rowValues(languages, 1)).toEqual([
      'Person id',
      'Employee number',
      '#',
      'Languages',
    ]);
    expect(languages?.rowCount).toBe(1 + 3 * 2);
  });

  it('says what it is on an About sheet', async () => {
    const { files } = await exported(HR, { filter: 'Everyone in Madrid' });
    const about = (await open(files[0]?.bytes ?? new Uint8Array())).getWorksheet(
      'About this export',
    );
    const lines = Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((n) =>
        about ? (rowValues(about, n) as [string, unknown]) : ['', null],
      ),
    );
    expect(lines).toMatchObject({
      'Schema version': 4,
      'As of': '2026-09-22',
      Filter: 'Everyone in Madrid',
      'Exported by': HR.accountId,
      Rows: 3,
    });
    expect(lines['Fields']).toContain('base_salary');
  });
});

describe('who gets which columns', () => {
  it('a manager gets the fields a manager can read and no others', async () => {
    const { attributeKeys } = await exported(MANAGER);
    expect(attributeKeys).toEqual(['job_title']);
  });

  it('refuses a special-category field by name, the same as an unknown one', async () => {
    const store = financeTenant();
    const deps = {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      relations: store.deps.relations,
      records: store.deps,
      clock: store.deps.clock,
    };
    for (const field of ['health_notes', 'no_such_field']) {
      const refused = await buildExport(tx, deps, {
        ...asking(HR),
        format: 'csv',
        fields: [field],
      });
      expect(!refused.ok && refused.error.code).toBe('EXPORT_FIELD_REFUSED');
    }
  });
});

describe('the CSV register', () => {
  it('has two header rows, __missing_required, a file per repeating attribute, and guarded formulas', async () => {
    const { files } = await exported(HR, { format: 'csv' });
    expect(files.map((f) => f.name)).toEqual([
      'people-2026-09-22.csv',
      'people-2026-09-22-languages.csv',
    ]);
    const text = new TextDecoder().decode(files[0]?.bytes);
    const [labels, keys] = text.replace(/^﻿/u, '').split('\r\n');
    expect(labels?.endsWith('__missing_required')).toBe(true);
    expect(keys?.startsWith('__person_id,given_name')).toBe(true);
    expect(text).toContain('"\'=HYPERLINK(""https://evil.test"",""x"")"');
    expect(text).toContain('60000.50 EUR');
    expect(text).toMatch(/,cost_centre\r\n/u);
  });
});

describe('round-tripping (§15.3)', () => {
  it('export, edit one cell in Excel, re-import: only that cell changes', async () => {
    const store = financeTenant();
    const { files } = await exported(HR, {}, store);
    const wb = await open(files[0]?.bytes ?? new Uint8Array());
    const people = wb.getWorksheet('People');
    if (!people) throw new Error('no People sheet');
    const col = (rowValues(people, 2) as string[]).indexOf('cost_centre') + 1;
    const ada = [3, 4, 5].find((r) => people.getRow(r).getCell(1).value === ADA) ?? 0;
    people.getRow(ada).getCell(col).value = 'CC-42';
    const edited = new Uint8Array(await wb.xlsx.writeBuffer());

    const file = await parseUpload(edited);
    if (!file.ok) throw new Error(file.error.message);
    const version = await store.deps.schemas.current(tx, asking(HR).tenantId);
    if (!version) throw new Error('no version');
    const mapping = resolveMapping(
      await proposeMapping({ file: file.value, version, relations: HR_RELATIONS, advisor: null }),
      {},
      version,
      HR_RELATIONS,
    );
    if (!mapping.ok) throw new Error(mapping.error.message);

    const events = store.events.length;
    const result = await commitImport(tx, commitDeps(store), {
      ...asking(HR),
      file: file.value,
      mapping: mapping.value,
    });
    expect(result.ok && result.value.status === 'imported' && result.value.counts).toMatchObject({
      updated: 1,
      unchanged: 2,
      blocked: 0,
      created: 0,
    });
    expect(store.history.map((h) => [h.personId, h.attributeKey, h.value])).toEqual([
      [ADA, 'cost_centre', 'CC-42'],
    ]);
    // The edit, and — a cost centre being where somebody sits — the org move
    // OpenFGA's tuples are re-read from (PEO-092).
    expect(store.events.slice(events).map((e) => e.eventName)).toEqual([
      'people.person.profile_updated',
      'people.person.org_changed',
    ]);
    expect(store.secrets.get(`${ADA}:iban`)).toBe('ES9121000418450200051332');
  });
});

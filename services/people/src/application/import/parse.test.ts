import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { deflateRawSync } from 'node:zlib';

import { declaredUncompressedSize, parseUpload, type ParsedFile } from './parse.js';

/**
 * PEO-038: three very different files, one intermediate shape.
 *
 * The fixtures are built here rather than checked in as binaries so what each
 * one exercises is readable in the diff: a BOM, a semicolon, a second sheet.
 */

const HEADERS = ['Given name', 'Work email', 'Hire date', 'Cost centre'];
const ROWS = [
  ['Ada', 'ada@acme.test', '2026-01-05', 'CC-10'],
  ['José', 'jose@acme.test', '2026-02-01', 'CC-20'],
];

const utf8 = (s: string) => new TextEncoder().encode(s);

/** What every fixture must come out as, minus the fields that describe the format. */
const shape = (f: ParsedFile) => ({ headers: f.headers, keys: f.keys, rows: f.rows });
const expected = {
  headers: HEADERS,
  keys: null,
  rows: ROWS.map((cells, i) => ({ row: i + 2, cells })),
};

async function workbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  // The people are on the second sheet, which is the point of selecting one.
  const notes = wb.addWorksheet('Read me');
  notes.addRow(['Exported from the old HRIS']);
  const people = wb.addWorksheet('People');
  people.addRow(HEADERS);
  for (const [name, email, hired, cc] of ROWS) {
    people.addRow([name, email, new Date(`${hired as string}T00:00:00Z`), cc]);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('three fixtures, one shape', () => {
  it('UTF-8 with a BOM and CRLF', async () => {
    const text = [HEADERS, ...ROWS].map((r) => r.join(',')).join('\r\n');
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]);
    const parsed = await parseUpload(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ format: 'csv', encoding: 'utf-8', delimiter: ',' });
    // No BOM glued to the first header, which is the bug a BOM causes.
    expect(shape(parsed.value)).toEqual(expected);
  });

  it('semicolon-delimited, in Windows-1252, with a quoted semicolon', async () => {
    const quoted = [HEADERS, ...ROWS].map((r) =>
      r.map((c) => (c === 'CC-20' ? '"CC-20"' : c)).join(';'),
    );
    // é is 0xE9 in Windows-1252 and an invalid UTF-8 sequence on its own.
    const bytes = Uint8Array.from(
      Array.from(quoted.join('\n'), (ch) => (ch === 'é' ? 0xe9 : ch.charCodeAt(0))),
    );
    const parsed = await parseUpload(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ encoding: 'windows-1252', delimiter: ';' });
    expect(shape(parsed.value)).toEqual(expected);
  });

  it('a multi-sheet workbook, with the sheet chosen', async () => {
    const parsed = await parseUpload(await workbook(), { sheet: 'People' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      format: 'xlsx',
      sheets: ['Read me', 'People'],
      sheet: 'People',
    });
    expect(shape(parsed.value)).toEqual(expected);
  });

  it('the first sheet is read when none is named, and a missing one is refused', async () => {
    const bytes = await workbook();
    const first = await parseUpload(bytes);
    expect(first.ok && first.value.headers).toEqual(['Exported from the old HRIS']);
    const missing = await parseUpload(bytes, { sheet: 'Nope' });
    expect(!missing.ok && missing.error.code).toBe('SHEET_NOT_FOUND');
  });
});

describe('detection', () => {
  it('reads UTF-16LE with its BOM, and tabs', async () => {
    const text = [HEADERS, ...ROWS].map((r) => r.join('\t')).join('\n');
    const body = Buffer.from(text, 'utf16le');
    const parsed = await parseUpload(new Uint8Array([0xff, 0xfe, ...body]));
    expect(parsed.ok && parsed.value.delimiter).toBe('\t');
    expect(parsed.ok && shape(parsed.value)).toEqual(expected);
  });

  it('recognises a Kithena export by its key row, and keeps quoted newlines in a cell', async () => {
    const text = 'Person id,Notes\n__person_id,notes\np1,"line one\nline two"\n';
    const parsed = await parseUpload(utf8(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.keys).toEqual(['__person_id', 'notes']);
    expect(parsed.value.rows).toEqual([{ row: 3, cells: ['p1', 'line one\nline two'] }]);
  });

  it('takes off the formula guard our own writer adds', async () => {
    const parsed = await parseUpload(utf8("Phone,Formula\n'+34600000000,'=1+1\n"));
    expect(parsed.ok && parsed.value.rows[0]?.cells).toEqual(['+34600000000', '=1+1']);
  });

  it('checksums the bytes, so the same file has the same key', async () => {
    const a = await parseUpload(utf8('A\n1\n'));
    const b = await parseUpload(utf8('A\n1\n'));
    const c = await parseUpload(utf8('A\n2\n'));
    expect(a.ok && b.ok && a.value.checksum === b.value.checksum).toBe(true);
    expect(a.ok && c.ok && a.value.checksum === c.value.checksum).toBe(false);
  });
});

describe('limits', () => {
  it('refuses an empty file and one past 50,000 rows', async () => {
    const empty = await parseUpload(new Uint8Array());
    expect(!empty.ok && empty.error.code).toBe('FILE_EMPTY');
    const big = await parseUpload(utf8(`A\n${'1\n'.repeat(50_001)}`));
    expect(!big.ok && big.error.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses a zip bomb from its directory, without inflating it', async () => {
    // One entry of 1 GB of zeros, declared in the central directory.
    const name = utf8('xl/worksheets/sheet1.xml');
    const data = deflateRawSync(Buffer.alloc(1024));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(1024 * 1024 * 1024, 24);
    central.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + name.length, 12);
    eocd.writeUInt32LE(30 + name.length + data.length, 16);
    const bomb = new Uint8Array(Buffer.concat([local, name, data, central, name, eocd]));

    expect(declaredUncompressedSize(bomb)).toBe(1024 * 1024 * 1024);
    const parsed = await parseUpload(bomb);
    expect(!parsed.ok && parsed.error.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses a zip that is not a workbook', async () => {
    const parsed = await parseUpload(utf8('PK\u0003\u0004 not really'));
    expect(!parsed.ok && parsed.error.code).toBe('FILE_UNREADABLE');
  });
});

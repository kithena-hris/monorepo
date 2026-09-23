import { createHash } from 'node:crypto';

import ExcelJS from 'exceljs';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Upload and detect (PRD §14.1, §14.2): bytes in, one intermediate shape out.
 *
 * CSV, TSV and XLSX all arrive here and leave as the same `ParsedFile` — a
 * header row, an optional key row, and rows of trimmed strings with the row
 * number the admin would see in their spreadsheet. Nothing downstream knows
 * which format a value came from, which is what lets the mapping and the dry
 * run be written once.
 *
 * **Nothing is written by this step.** It reads bytes and returns a value.
 *
 * Every cell is a string here, deliberately. Coercing "01/02/2026" into a
 * date at parse time would be guessing a locale before the column is known to
 * be a date at all; the dry run coerces against the attribute's type and
 * names the cell when it cannot.
 */

export const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_ROWS = 50_000;
/**
 * The most an XLSX may inflate to. The zip's own directory is read before the
 * workbook is opened, so a 40 KB file claiming 4 GB of XML is refused without
 * inflating a byte of it.
 */
export const MAX_UNCOMPRESSED = 256 * 1024 * 1024;

/** The column the export writes first, and what marks row 2 as the key row (§15.3). */
export const PERSON_ID_COLUMN = '__person_id';

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface ParsedRow {
  /** 1-based, as the spreadsheet numbers it, so a report can say "row 14". */
  readonly row: number;
  readonly cells: readonly string[];
}

export interface ParsedFile {
  readonly format: 'csv' | 'xlsx';
  /** Null for XLSX, whose XML declares its own. */
  readonly encoding: Encoding | null;
  readonly delimiter: ',' | ';' | '\t' | '|' | null;
  /** Every sheet in the workbook, in order. Empty for a text file. */
  readonly sheets: readonly string[];
  readonly sheet: string | null;
  /** Row 1. */
  readonly headers: readonly string[];
  /**
   * Row 2, when it is a Kithena export's stable-key row.
   *
   * Recognised by `__person_id`, never guessed from its shape: a data row of
   * lowercase names looks exactly like a row of keys.
   */
  readonly keys: readonly string[] | null;
  readonly rows: readonly ParsedRow[];
  /** SHA-256 of the bytes as uploaded; the import key is derived from it. */
  readonly checksum: string;
}

export interface ParseOptions {
  /** Which sheet holds people. The first, unless told (§14.1). */
  readonly sheet?: string;
}

const tooBig = (what: string) => err(failure('FILE_TOO_LARGE', what, ['file']));

export async function parseUpload(
  bytes: Uint8Array,
  options: ParseOptions = {},
): Promise<Result<ParsedFile>> {
  if (bytes.byteLength > MAX_BYTES)
    return tooBig('A file is at most 100 MB; split it into several');
  if (bytes.byteLength === 0) return err(failure('FILE_EMPTY', 'The file is empty', ['file']));

  const checksum = createHash('sha256').update(bytes).digest('hex');
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const table = isZip ? await readWorkbook(bytes, options) : readText(bytes);
  if (!table.ok) return table;

  const { grid, ...detected } = table.value;
  const [headerCells, ...rest] = grid.filter((r) => r.cells.some((c) => c !== ''));
  if (!headerCells) return err(failure('FILE_EMPTY', 'The file has no header row', ['file']));

  const headers = headerCells.cells;
  const second = rest[0];
  const keys = second?.cells.includes(PERSON_ID_COLUMN) ? second.cells : null;
  const rows = keys ? rest.slice(1) : rest;
  if (rows.length > MAX_ROWS) {
    return tooBig(`A file is at most ${String(MAX_ROWS)} rows; split it into several`);
  }

  const width = headers.length;
  return ok({
    ...detected,
    headers,
    keys: keys ? pad(keys, width) : null,
    rows: rows.map((r) => ({ row: r.row, cells: pad(r.cells, width) })),
    checksum,
  });
}

function pad(cells: readonly string[], width: number): readonly string[] {
  if (cells.length >= width) return cells.slice(0, width);
  return [...cells, ...Array.from({ length: width - cells.length }, () => '')];
}

type Detected = Omit<ParsedFile, 'headers' | 'keys' | 'rows' | 'checksum'> & {
  grid: ParsedRow[];
};

/* ------------------------------------------------------------------ text -- */

/**
 * The encoding, from the BOM or else by trying.
 *
 * UTF-8 decoded with `fatal` either succeeds or proves the file is not UTF-8;
 * the only single-byte encoding a spreadsheet realistically exports in is
 * Windows-1252 ("CSV" from Excel on a Western-European Windows), and it maps
 * every byte, so it is the fallback rather than a guess among many.
 */
export function detectEncoding(bytes: Uint8Array): { encoding: Encoding; bom: number } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { encoding: 'utf-8', bom: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { encoding: 'utf-8', bom: 0 };
  } catch {
    return { encoding: 'windows-1252', bom: 0 };
  }
}

const DELIMITERS = [',', ';', '\t', '|'] as const;

/** The candidate that splits the header line most, counting only outside quotes. */
export function detectDelimiter(text: string): (typeof DELIMITERS)[number] {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best: (typeof DELIMITERS)[number] = ',';
  for (const d of DELIMITERS) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  return best;
}

/**
 * The guard our own CSV writer puts in front of a cell that a spreadsheet
 * would run as a formula (§15.x, OWASP's CSV injection advice), taken off
 * again so a round-tripped "+34 600…" is the phone number it was.
 */
const GUARDED = /^'[=+\-@\t\r]/u;
export const unguard = (cell: string): string => (GUARDED.test(cell) ? cell.slice(1) : cell);

/** RFC 4180, with LF, CRLF or CR line ends and the detected delimiter. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

function readText(bytes: Uint8Array): Result<Detected> {
  const { encoding, bom } = detectEncoding(bytes);
  const text = new TextDecoder(encoding).decode(bytes.subarray(bom));
  const delimiter = detectDelimiter(text);
  const grid = splitCsv(text, delimiter).map((cells, i) => ({
    row: i + 1,
    cells: cells.map((c) => unguard(c.trim())),
  }));
  return ok({ format: 'csv', encoding, delimiter, sheets: [], sheet: null, grid });
}

/* ------------------------------------------------------------------ xlsx -- */

/**
 * The uncompressed total the zip's central directory declares.
 *
 * Read from the End Of Central Directory record rather than by inflating: the
 * point is to refuse a bomb before any of it is expanded. A ZIP64 archive
 * (sizes of 0xFFFFFFFF) is refused outright — no spreadsheet under the 100 MB
 * limit needs one, and its sizes live somewhere this does not read.
 */
export function declaredUncompressedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The EOCD is at least 22 bytes from the end, plus up to 64 KB of comment.
  const floor = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entries = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== 0x02014b50) return null;
    const size = view.getUint32(at + 24, true);
    if (size === 0xffffffff) return null;
    total += size;
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return total;
}

async function readWorkbook(bytes: Uint8Array, options: ParseOptions): Promise<Result<Detected>> {
  const declared = declaredUncompressedSize(bytes);
  if (declared === null) {
    return err(failure('FILE_UNREADABLE', 'This is not a spreadsheet we can read', ['file']));
  }
  if (declared > MAX_UNCOMPRESSED) {
    return tooBig('This workbook expands to more than a spreadsheet of people ever needs');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as never,
    );
  } catch {
    return err(failure('FILE_UNREADABLE', 'This is not a spreadsheet we can read', ['file']));
  }

  const sheets = workbook.worksheets.map((w) => w.name);
  const worksheet =
    options.sheet === undefined
      ? workbook.worksheets[0]
      : workbook.worksheets.find((w) => w.name === options.sheet);
  if (!worksheet) {
    return err(
      failure('SHEET_NOT_FOUND', `No sheet called ${options.sheet ?? '(first)'}`, ['sheet']),
    );
  }
  if (worksheet.rowCount > MAX_ROWS + 2) {
    return tooBig(`A file is at most ${String(MAX_ROWS)} rows; split it into several`);
  }

  const grid: ParsedRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const cell = row.getCell(c);
      cells.push(cellText(cell.value, cell.numFmt).trim());
    }
    grid.push({ row: rowNumber, cells });
  });

  return ok({
    format: 'xlsx',
    encoding: null,
    delimiter: null,
    sheets,
    sheet: worksheet.name,
    grid,
  });
}

/** `[$EUR]` in a number format is how the export marks a money column's currency. */
const CURRENCY_FORMAT = /\[\$([A-Z]{3})\]/u;

/** One cell as the string the admin would read in it. */
export function cellText(value: ExcelJS.CellValue, numFmt?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    const currency = numFmt ? CURRENCY_FORMAT.exec(numFmt)?.[1] : undefined;
    return currency ? `${String(value)} ${currency}` : String(value);
  }
  if (value instanceof Date) {
    const iso = value.toISOString();
    // A date cell is stored as midnight UTC; anything else carries a time.
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('formula' in value || 'sharedFormula' in value) {
    return cellText((value as { result?: ExcelJS.CellValue }).result ?? null, numFmt);
  }
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return '';
}

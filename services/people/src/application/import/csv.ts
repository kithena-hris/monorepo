/**
 * Writing CSV that a spreadsheet will open, safely.
 *
 * A cell beginning `=`, `+`, `-`, `@`, a tab or a carriage return is run as a
 * formula by Excel, LibreOffice and Sheets — which is how an employee who
 * types `=HYPERLINK("https://evil", "Click")` into their preferred name ends
 * up in an HR admin's spreadsheet as a working link (OWASP, "CSV Injection").
 * Every such cell is written with a leading apostrophe, which every one of
 * those programs reads as "this is text"; `parse.ts`'s `unguard` takes it off
 * again on re-import, so a round-tripped "+34 600…" is the phone number it was.
 */

const DANGEROUS = /^[=+\-@\t\r]/u;

/** A plain number is left alone: "-5" runs as nothing but minus five, and a script reading it wants -5. */
const NUMBER = /^-?\d+(\.\d+)?$/u;

export const guard = (cell: string): string =>
  DANGEROUS.test(cell) && !NUMBER.test(cell) ? `'${cell}` : cell;

const quote = (cell: string): string =>
  /[",\n\r]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;

const BOM = String.fromCodePoint(0xfeff);

/** RFC 4180, CRLF, UTF-8 with a BOM so Excel does not read it as Windows-1252. */
export function writeCsv(rows: readonly (readonly string[])[]): Uint8Array {
  const text = rows.map((r) => r.map((c) => quote(guard(c))).join(',')).join('\r\n');
  return new TextEncoder().encode(`${BOM}${text}\r\n`);
}

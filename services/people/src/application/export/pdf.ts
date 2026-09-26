import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

/**
 * The two PDF documents (PRD §15.5): an employee record and a roster.
 *
 * Only the paper is drawn here. What is on it — which fields, "Not provided",
 * how many were withheld — is decided in `export.ts` from the same read the
 * CSV and XLSX come from, so this file has no opinion about access.
 *
 * **Noto Sans, embedded** from `assets/fonts` (vendored, OFL 1.1), not a
 * standard PDF font: those carry Latin-1 only,
 * and "Łukasz Dvořák" would print as garbage on a record handed to a labour
 * inspector. Noto covers Latin, Greek and Cyrillic; a character outside it
 * prints as a visible box rather than a wrong letter. `ponytail:` CJK and
 * other scripts need a second face registered per script when a tenant asks.
 */

export interface Cell {
  readonly text: string;
  /** "Not provided" and "Withheld": muted, never blank (§15.4). */
  readonly muted?: boolean;
}

interface Furniture {
  readonly title: string;
  /** Under the title: the filter, the as-of day, the employee number. */
  readonly lines: readonly string[];
  readonly generatedAt: string;
  readonly generatedBy: string;
  /** Fields on the page's subject the requester could not be shown (§15.5). */
  readonly withheld: number;
}

export interface RecordDocument extends Furniture {
  readonly sections: readonly {
    readonly label: string;
    readonly fields: readonly { readonly label: string; readonly value: Cell }[];
  }[];
}

export interface RosterDocument extends Furniture {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

export const PDF_TYPE = 'application/pdf';

// `assets/fonts` at the package root: three levels up from `src/…/export`,
// four from `dist/src/…/export`. `pnpm deploy` copies the package whole.
const FONT_DIR = ['../../../assets/fonts/', '../../../../assets/fonts/']
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  .find((dir) => existsSync(join(dir, 'OFL.txt')));
if (FONT_DIR === undefined) throw new Error('services/people/assets/fonts is missing');
const FONTS = {
  body: join(FONT_DIR, 'NotoSans_400Regular.ttf'),
  bold: join(FONT_DIR, 'NotoSans_700Bold.ttf'),
};
const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const MARGIN = 40;
const FOOTER = 24;
const PAD = 3;

function open(layout: 'portrait' | 'landscape'): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    layout,
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN + FOOTER },
    bufferPages: true,
    info: { Producer: 'People', Creator: 'People' },
  });
  doc.registerFont('body', FONTS.body);
  doc.registerFont('bold', FONTS.bold);
  return doc.font('body').fillColor(INK);
}

const bottom = (doc: PDFKit.PDFDocument) => doc.page.height - doc.page.margins.bottom;
const width = (doc: PDFKit.PDFDocument) =>
  doc.page.width - doc.page.margins.left - doc.page.margins.right;

function heading(doc: PDFKit.PDFDocument, f: Furniture): number {
  let y = MARGIN;
  doc
    .font('bold')
    .fontSize(14)
    .fillColor(INK)
    .text(f.title, MARGIN, y, { width: width(doc) });
  y = doc.y + 2;
  doc.font('body').fontSize(9).fillColor(MUTED);
  for (const line of f.lines) {
    doc.text(line, MARGIN, y, { width: width(doc) });
    y = doc.y;
  }
  return y + 10;
}

/** Generated at and by, the withheld count, and "Page 3 of 7" on every page. */
async function finish(doc: PDFKit.PDFDocument, f: Furniture): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((resolve) => doc.on('end', resolve));
  const { start, count } = doc.bufferedPageRange();
  const withheld =
    f.withheld === 0
      ? 'No fields withheld'
      : `${String(f.withheld)} ${f.withheld === 1 ? 'field' : 'fields'} withheld from the requester`;
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    // Below the bottom margin: without this pdfkit would start a new page.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN - 10;
    const w = width(doc);
    doc.font('body').fontSize(8).fillColor(MUTED);
    doc.text(`Generated ${f.generatedAt} by ${f.generatedBy} · ${withheld}`, MARGIN, y, {
      width: w - 80,
      lineBreak: false,
    });
    doc.text(`Page ${String(i - start + 1)} of ${String(count)}`, MARGIN + w - 80, y, {
      width: 80,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}

function cell(doc: PDFKit.PDFDocument, c: Cell, x: number, y: number, w: number, h: number): void {
  doc.fillColor(c.muted ? MUTED : INK).text(c.text, x + PAD, y + PAD, {
    width: w - 2 * PAD,
    height: h - PAD,
    ellipsis: true,
  });
}

/** One person, section by section, as the profile screen lays them out. */
export function recordPdf(d: RecordDocument): Promise<Uint8Array> {
  const doc = open('portrait');
  const w = width(doc);
  const labelW = Math.round(w * 0.35);
  let y = heading(doc, d);
  for (const section of d.sections) {
    doc.font('bold').fontSize(11);
    if (y + 40 > bottom(doc)) {
      doc.addPage();
      y = MARGIN;
    }
    doc.fillColor(INK).text(section.label, MARGIN, y, { width: w });
    y = doc.y + 2;
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + w, y)
      .lineWidth(0.5)
      .stroke(RULE);
    y += 2;
    doc.font('body').fontSize(9);
    for (const f of section.fields) {
      const h =
        Math.max(
          doc.heightOfString(f.label, { width: labelW - 2 * PAD }),
          doc.heightOfString(f.value.text, { width: w - labelW - 2 * PAD }),
        ) +
        2 * PAD;
      if (y + h > bottom(doc)) {
        doc.addPage();
        y = MARGIN;
      }
      const room = Math.min(h, bottom(doc) - y);
      cell(doc, { text: f.label, muted: true }, MARGIN, y, labelW, room);
      cell(doc, f.value, MARGIN + labelW, y, w - labelW, room);
      y += room;
    }
    y += 10;
  }
  return finish(doc, d);
}

/**
 * One row per person, landscape, the column headers and the filter repeated
 * on every page so any page on its own says what it is a page of.
 *
 * `ponytail:` equal column widths. Fifty columns on A4 is unreadable however
 * they are shared out; the builder's field picker is the answer to that.
 */
export function rosterPdf(d: RosterDocument): Promise<Uint8Array> {
  const doc = open('landscape');
  const w = width(doc);
  const colW = w / Math.max(d.headers.length, 1);
  const size = d.headers.length > 12 ? 7 : 8;
  const heights = (cells: readonly Cell[]) =>
    Math.max(12, ...cells.map((c) => doc.heightOfString(c.text, { width: colW - 2 * PAD }))) +
    2 * PAD;
  const top = (): number => {
    const y = heading(doc, d);
    doc.font('bold').fontSize(size);
    const h = Math.min(heights(d.headers.map((text) => ({ text }))), 60);
    d.headers.forEach((text, i) => {
      cell(doc, { text }, MARGIN + i * colW, y, colW, h);
    });
    doc
      .moveTo(MARGIN, y + h)
      .lineTo(MARGIN + w, y + h)
      .lineWidth(0.75)
      .stroke(INK);
    doc.font('body').fontSize(size);
    return y + h;
  };

  let y = top();
  for (const row of d.rows) {
    const h = heights(row);
    if (y + h > bottom(doc)) {
      doc.addPage();
      y = top();
    }
    const room = Math.min(h, bottom(doc) - y);
    row.forEach((c, i) => {
      cell(doc, c, MARGIN + i * colW, y, colW, room);
    });
    y += room;
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + w, y)
      .lineWidth(0.25)
      .stroke(RULE);
  }
  return finish(doc, d);
}

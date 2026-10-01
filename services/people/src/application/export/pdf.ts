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
  /** Their profile photo, PNG or JPEG, at the top right. */
  readonly photo?: Uint8Array;
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

/** The title and its lines; `reserve` keeps that much of the right edge clear (a photo). */
function heading(doc: PDFKit.PDFDocument, f: Furniture, reserve = 0): number {
  let y = MARGIN;
  doc
    .font('bold')
    .fontSize(14)
    .fillColor(INK)
    .text(f.title, MARGIN, y, { width: width(doc) - reserve });
  y = doc.y + 2;
  doc.font('body').fontSize(9).fillColor(MUTED);
  for (const line of f.lines) {
    doc.text(line, MARGIN, y, { width: width(doc) - reserve });
    y = doc.y;
  }
  return y + 10;
}

/**
 * Generated at and by, the withheld count (or `note` in its place), and
 * "Page 3 of 7" on every page.
 */
async function finish(doc: PDFKit.PDFDocument, f: Furniture, note?: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((resolve) => doc.on('end', resolve));
  const { start, count } = doc.bufferedPageRange();
  const withheld =
    note ??
    (f.withheld === 0
      ? 'No fields withheld'
      : `${String(f.withheld)} ${f.withheld === 1 ? 'field' : 'fields'} withheld from the requester`);
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
  let y = heading(doc, d, d.photo === undefined ? 0 : 80);
  if (d.photo !== undefined) {
    // Square, top right, level with the name: the record's own face.
    const size = 64;
    doc.image(Buffer.from(d.photo), MARGIN + w - size, MARGIN, { fit: [size, size], align: 'right' });
    y = Math.max(y, MARGIN + size + 10);
  }
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

/** An Insights summary as sent (design AI6): its points, a chart, how it was made. */
export interface SummaryPdfDocument {
  readonly company: string | null;
  readonly title: string;
  readonly preparedBy: string;
  readonly preparedOn: string;
  readonly points: readonly { readonly figure: string; readonly text: string }[];
  readonly chart: readonly { readonly label: string; readonly value: number }[] | null;
  readonly madeLine: string | null;
  readonly generatedAt: string;
}

/**
 * A summary on paper, as the preview draws it: the company over the title,
 * who prepared it, each point with its figure, headcount by month as a line,
 * and the line on how it was made. Aggregates only, so nothing is withheld.
 */
export function summaryPdf(d: SummaryPdfDocument): Promise<Uint8Array> {
  const doc = open('portrait');
  const w = width(doc);
  let y = MARGIN;
  doc
    .font('bold')
    .fontSize(8)
    .fillColor(MUTED)
    .text(`${d.company === null ? '' : `${d.company.toUpperCase()} · `}PEOPLE REPORT`, MARGIN, y, {
      width: w,
      characterSpacing: 0.8,
    });
  y = doc.y + 6;
  doc.font('bold').fontSize(20).fillColor(INK).text(d.title, MARGIN, y, { width: w });
  y = doc.y + 2;
  doc
    .font('body')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`Prepared by ${d.preparedBy} · ${d.preparedOn}`, MARGIN, y, { width: w });
  y = doc.y + 14;

  const figureW = 56;
  for (const point of d.points) {
    doc.font('body').fontSize(11);
    const h = Math.max(16, doc.heightOfString(point.text, { width: w - figureW }));
    if (y + h > bottom(doc)) {
      doc.addPage();
      y = MARGIN;
    }
    doc.font('bold').fillColor(INK).text(point.figure, MARGIN, y, { width: figureW - 8 });
    doc.font('body').text(point.text, MARGIN + figureW, y, { width: w - figureW });
    y += h + 10;
  }

  const chart = d.chart;
  if (chart !== null && chart.length > 1) {
    const h = 90;
    if (y + h + 30 > bottom(doc)) {
      doc.addPage();
      y = MARGIN;
    }
    doc.font('bold').fontSize(9).fillColor(MUTED).text('Headcount by month', MARGIN, y);
    y = doc.y + 6;
    const values = chart.map((p) => p.value);
    const low = Math.min(...values);
    const span = Math.max(Math.max(...values) - low, 1);
    const step = w / (chart.length - 1);
    chart.forEach((p, i) => {
      const x = MARGIN + i * step;
      // A flat line sits mid-box rather than on its floor.
      const py =
        Math.max(...values) === low ? y + h / 2 : y + h - ((p.value - low) / span) * (h - 10) - 5;
      if (i === 0) doc.moveTo(x, py);
      else doc.lineTo(x, py);
    });
    doc.lineWidth(1.5).stroke('#5b50e8');
    doc.font('body').fontSize(8).fillColor(MUTED);
    chart.forEach((p, i) => {
      const x = MARGIN + i * step;
      doc.text(p.label, Math.min(Math.max(MARGIN, x - 20), MARGIN + w - 40), y + h + 4, {
        width: 40,
        align: i === 0 ? 'left' : i === chart.length - 1 ? 'right' : 'center',
        lineBreak: false,
      });
    });
    y += h + 20;
  }

  if (d.madeLine !== null) {
    doc.font('body').fontSize(9).fillColor(MUTED).text(d.madeLine, MARGIN, y, { width: w });
  }
  return finish(
    doc,
    { title: d.title, lines: [], generatedAt: d.generatedAt, generatedBy: d.preparedBy, withheld: 0 },
    'Aggregates only; groups under the cohort minimum are never described',
  );
}

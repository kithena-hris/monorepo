import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate } from '@kithena/contracts';

import type { Caller, Deps } from '../ports.js';
import { inspectorRecord, type InspectorRecord } from './attendance.js';

export interface InspectorFile {
  readonly name: string;
  readonly contentType: string;
  readonly base64: string;
}

/** The record for a period as a file to download, HR only (`inspectorRecord` decides). */
export const inspectorExport =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  async (
    caller: Caller,
    input: {
      readonly from: CalendarDate;
      readonly to: CalendarDate;
      readonly format: 'csv' | 'pdf';
    },
  ): Promise<Result<InspectorFile>> => {
    const record = await inspectorRecord(deps)(caller, input);
    if (!record.ok) return record;
    const name = `working-time-${input.from}-to-${input.to}.${input.format}`;
    if (input.format === 'csv') {
      const csv = Buffer.from(inspectorCsv(record.value), 'utf8');
      return ok({ name, contentType: 'text/csv; charset=utf-8', base64: csv.toString('base64') });
    }
    const pdf = await inspectorPdf(record.value, {
      generatedAt: `${deps.clock.instant().slice(0, 16).replace('T', ' ')} UTC`,
    });
    return ok({
      name,
      contentType: 'application/pdf',
      base64: Buffer.from(pdf).toString('base64'),
    });
  };

/**
 * The labour inspector's record on paper and as a spreadsheet (PRD §11.7):
 * per person, per day, start, end, breaks and the time it came to. What is
 * on it is `inspectorRecord`'s; this file only lays it out.
 *
 * Noto Sans embedded from `assets/fonts` (vendored, OFL 1.1), People's
 * reason: the standard PDF fonts carry Latin-1 only, and a name on a record
 * handed to an inspector must print as it is spelt.
 */

const HEADERS = ['Person', 'Date', 'Start', 'End', 'Breaks', 'Break minutes', 'Worked'] as const;

const worked = (minutes: number | null): string =>
  minutes === null
    ? ''
    : `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;

function rows(record: InspectorRecord): string[][] {
  return record.people.flatMap((p) =>
    p.days.map((d) => [
      p.displayName,
      d.date,
      d.start,
      d.end ?? '',
      d.breaks.map((b) => `${b.start}–${b.end ?? ''}`).join(' '),
      String(d.breakMinutes),
      worked(d.workedMinutes),
    ]),
  );
}

/** A field as RFC 4180 has it, and never a formula a spreadsheet would run. */
const field = (value: string): string => {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\n\r]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function inspectorCsv(record: InspectorRecord): string {
  return `${[HEADERS, ...rows(record)].map((r) => r.map(field).join(',')).join('\r\n')}\r\n`;
}

// `assets/fonts` at the package root: three levels up from `src/application/attendance`.
const FONT_DIR = ['../../../assets/fonts/', '../../../../assets/fonts/']
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  .find((dir) => existsSync(join(dir, 'OFL.txt')));

const MARGIN = 40;
const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
/** Each column's share of the page's width. */
const WIDTHS = [0.24, 0.12, 0.08, 0.08, 0.24, 0.12, 0.12];

export async function inspectorPdf(
  record: InspectorRecord,
  furniture: { readonly generatedAt: string },
): Promise<Uint8Array> {
  if (FONT_DIR === undefined) throw new Error('services/timeoff/assets/fonts is missing');
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN + 20 },
    bufferPages: true,
    info: { Producer: 'Time Off', Creator: 'Time Off', Title: 'Daily working-time record' },
  });
  doc.registerFont('body', join(FONT_DIR, 'NotoSans_400Regular.ttf'));
  doc.font('body');
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((resolve) => doc.on('end', resolve));

  const width = doc.page.width - 2 * MARGIN;
  const bottom = (): number => doc.page.height - doc.page.margins.bottom;
  const columns = WIDTHS.map((w) => w * width);
  const line = (cells: readonly string[], y: number, colour: string): void => {
    let x = MARGIN;
    cells.forEach((text, i) => {
      const w = columns[i] ?? 0;
      doc
        .fillColor(colour)
        .text(text, x + 3, y + 3, { width: w - 6, lineBreak: false, ellipsis: true });
      x += w;
    });
  };
  // The title and the headers on every page, so a page on its own says what it is.
  const head = (): number => {
    doc.fontSize(14).fillColor(INK).text('Daily working-time record', MARGIN, MARGIN);
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Start, end and breaks per person, ${record.from} to ${record.to}`, MARGIN, doc.y + 2);
    const y = doc.y + 8;
    doc.fontSize(9);
    line(HEADERS, y, MUTED);
    doc
      .moveTo(MARGIN, y + 16)
      .lineTo(MARGIN + width, y + 16)
      .lineWidth(0.5)
      .stroke(RULE);
    return y + 18;
  };

  let y = head();
  const body = rows(record);
  if (body.length === 0) doc.fillColor(MUTED).text('Nobody punched in this period.', MARGIN, y + 3);
  for (const r of body) {
    if (y + 16 > bottom()) {
      doc.addPage();
      y = head();
    }
    line(r, y, INK);
    y += 16;
  }

  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Generated ${furniture.generatedAt} · Page ${String(i - start + 1)} of ${String(count)}`,
        MARGIN,
        doc.page.height - MARGIN - 10,
        { width, lineBreak: false },
      );
    doc.page.margins.bottom = keep;
  }
  doc.end();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}

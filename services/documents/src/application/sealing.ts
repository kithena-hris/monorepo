import { inkBounds } from '@kithena/contracts';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

import type { Envelope } from '../domain/signature/envelope.js';
import { facesFor, scriptFor } from './fonts.js';
import type { EnvelopeEvent } from './ports.js';

/**
 * Sealing a signed document (PRD §10.3, K9): each field's value drawn where
 * it was placed — a typed signature in a script face, a drawn one as its
 * image — then a certificate of completion appended: every signer, how they
 * proved it was them, and every step with its time. The result is filed as a
 * new version whose SHA-256 is kept, so a changed copy no longer matches.
 */

const ACTIONS: Readonly<Record<string, string>> = {
  sent: 'Sent for signature',
  opened: 'Opened',
  code_sent: 'Code emailed',
  verified: 'Confirmed it was them',
  signed: 'Signed',
  declined: 'Declined',
  reassigned: 'Passed on',
  reminded: 'Reminded',
  asked: 'Asked a question',
  completed: 'Completed',
};

/**
 * Where each signer's signing is traced (K9): the id of their `signed`
 * event, and when it was, as the footer under every field they filled and
 * their line on the certificate. The id is the trail's own, so a footer on
 * paper leads to the one row that says who, how and when.
 */
export interface Trace {
  readonly id: string;
  readonly at: string;
}

export function tracesOf(trail: readonly EnvelopeEvent[]): ReadonlyMap<string, Trace> {
  const out = new Map<string, Trace>();
  for (const e of trail) {
    if (e.action === 'signed' && e.signerId !== null) out.set(e.signerId, { id: e.id, at: e.at });
  }
  return out;
}

/**
 * What is printed under a signed field, as e-signature services print it:
 * that it was signed electronically, through whom and when, then the
 * Signature ID that the certificate and the audit trail carry too.
 */
export function traceLines(trace: Trace): readonly [string, string] {
  const d = new Date(trace.at);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = Number.isNaN(d.getTime())
    ? trace.at
    : `${String(d.getUTCDate())} ${months.at(d.getUTCMonth()) ?? ''} ${String(d.getUTCFullYear())}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  return [`Electronically signed via Kithena on ${when}`, `Signature ID: ${trace.id}`];
}

/**
 * Every field a signer has filled, drawn where it was placed, each with its
 * trace under it. A field of somebody who has not signed has no value yet
 * and is left as it is, so the same drawing is the copy a later signer sees
 * mid-way and the sealed one at the end.
 */
async function stampFields(
  pdf: PDFDocument,
  envelope: Envelope,
  traces: ReadonlyMap<string, Trace>,
): Promise<{ body: PDFFont; bold: PDFFont; drawable: (text: string) => string }> {
  const { body, bold, drawable } = await facesFor(pdf);
  const ink = rgb(0.12, 0.16, 0.36);
  const pages = pdf.getPages();
  for (const field of envelope.fields) {
    const page = pages[field.page - 1];
    if (page === undefined || field.value === null || field.value === undefined) continue;
    const { width, height } = page.getSize();
    const box = {
      x: field.x * width,
      w: field.w * width,
      h: field.h * height,
      // PDF's origin is the bottom left; a field's is the top left.
      y: height - field.y * height - field.h * height,
    };
    const signer = envelope.signers.find((s) => s.id === field.signerId);
    const mark = signer?.signature ?? null;
    const stamp = async (b: Box, initialsOnly: boolean) => {
      if (mark === null) return;
      if (mark.kind === 'drawn') {
        drawCentred(page, mark.path, b, ink);
        return;
      }
      const text = initialsOnly ? initials(mark.text) : mark.text;
      const font = (await scriptFor(pdf, mark.style ?? 'flowing', text)) ?? body;
      writeCentred(page, font === body ? drawable(text) : text, font, b, ink, 0.95);
    };
    if ((field.kind === 'signature' || field.kind === 'initials') && mark !== null) {
      await stamp(box, field.kind === 'initials');
    } else if (field.kind === 'date' && mark !== null) {
      // A dated signature: the signature over its upper part, the day under it.
      const under = box.h * 0.3;
      await stamp({ ...box, y: box.y + under, h: box.h - under }, false);
      writeCentred(page, drawable(field.value), body, { ...box, h: under }, ink, 0.8, 10);
    } else {
      const text = field.kind === 'checkbox' ? (field.value === 'true' ? 'X' : '') : field.value;
      writeCentred(page, drawable(text), body, box, ink, 0.8, 12);
    }
    const trace = traces.get(field.signerId);
    if (trace !== undefined) {
      // Two lines under the box, or inside its foot when it sits at the page's edge.
      const size = 5.5;
      const lead = size + 1.5;
      const top = box.y - lead - 1 >= lead + 2 ? box.y - lead - 1 : box.y + lead + 2;
      for (const [i, text] of traceLines(trace).entries()) {
        page.drawText(drawable(text), {
          x: box.x,
          y: top - i * lead,
          size,
          font: body,
          color: rgb(0.42, 0.44, 0.5),
        });
      }
    }
  }
  return { body, bold, drawable };
}

/**
 * The document as signed so far (K7): every signature in, with its trace,
 * and no certificate yet. What the next signer reads, and the copy each
 * signer is emailed when they sign.
 */
export async function stampSoFar(
  original: Uint8Array,
  envelope: Envelope,
  trail: readonly EnvelopeEvent[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
  await stampFields(pdf, envelope, tracesOf(trail));
  return pdf.save();
}

export async function seal(
  original: Uint8Array,
  envelope: Envelope,
  trail: readonly EnvelopeEvent[],
  company: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
  const traces = tracesOf(trail);
  const { body, bold, drawable } = await stampFields(pdf, envelope, traces);

  const page = pdf.addPage([595, 842]);
  let y = 780;
  const line = (text: string, size = 10, font = body) => {
    page.drawText(drawable(text.slice(0, 110)), {
      x: 56,
      y,
      size,
      font,
      color: rgb(0.15, 0.15, 0.2),
    });
    y -= size + 6;
  };
  line('Certificate of completion', 18, bold);
  y -= 6;
  line(`${company} · sealed by Kithena`, 10);
  line(
    `Request ${envelope.id} · version ${String(envelope.version)} of document ${envelope.documentId}`,
    9,
  );
  line(`Completed ${envelope.completedAt ?? ''}`, 9);
  y -= 10;
  line('Signers', 12, bold);
  for (const s of envelope.signers) {
    line(
      `${String(s.order)}. ${s.name} · ${s.check === 'login' ? 'their Kithena login' : `a code emailed to ${s.email ?? ''}`} · signed ${s.signedAt ?? ''}`,
      9,
    );
    const trace = traces.get(s.id);
    if (trace !== undefined) line(`    Signature ID: ${trace.id}`, 8);
  }
  y -= 10;
  line('What happened', 12, bold);
  for (const e of trail) {
    if (y < 60) break;
    const who = envelope.signers.find((s) => s.id === e.signerId)?.name ?? 'The sender';
    line(`${e.at} · ${who} · ${ACTIONS[e.action] ?? e.action}`, 9);
  }
  return pdf.save();
}

const initials = (name: string): string =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Text in the middle of its box, as large as fits: at most `fill` of the
 * box's height, and never wider than nine tenths of it.
 */
function writeCentred(
  page: PDFPage,
  text: string,
  font: PDFFont,
  box: Box,
  color: RGB,
  fill: number,
  most = Infinity,
): void {
  if (text === '') return;
  const unit = font.widthOfTextAtSize(text, 1);
  // By the face's whole height, tails and capitals included: a handwriting
  // face runs far above and below its size.
  const tall = font.heightAtSize(1);
  const size = Math.max(
    6,
    Math.min(most, (box.h * fill) / tall, unit === 0 ? Infinity : (box.w * 0.9) / unit),
  );
  const full = font.heightAtSize(size);
  const descent = full - font.heightAtSize(size, { descender: false });
  page.drawText(text, {
    x: box.x + (box.w - font.widthOfTextAtSize(text, size)) / 2,
    y: box.y + (box.h - full) / 2 + descent,
    size,
    font,
    color,
  });
}

/**
 * A drawn signature's ink in the middle of its box, scaled to fit with a
 * margin: the pad's own 400 × 120 frame and the blank around the strokes
 * are not part of the signature.
 */
function drawCentred(page: PDFPage, path: string, box: Box, color: RGB): void {
  const ink = inkBounds(path);
  if (ink === null) return;
  const scale = Math.min(
    (box.w * 0.9) / Math.max(ink.width, 1),
    (box.h * 0.85) / Math.max(ink.height, 1),
  );
  const top = box.y + box.h - (box.h - ink.height * scale) / 2;
  page.drawSvgPath(path, {
    x: box.x + (box.w - ink.width * scale) / 2 - ink.x * scale,
    y: top + ink.y * scale,
    scale,
    borderColor: color,
    borderWidth: 1.5 / scale,
  });
}

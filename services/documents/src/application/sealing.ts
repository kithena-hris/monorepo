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
    // Each draw says where its ink ends, so the print goes under what was
    // drawn rather than under the box, however much of the box it fills.
    const stamp = async (b: Box, initialsOnly: boolean): Promise<number> => {
      if (mark === null) return b.y + b.h / 2;
      if (mark.kind === 'drawn') return drawCentred(page, mark.path, b, ink);
      const text = initialsOnly ? initials(mark.text) : mark.text;
      const font = (await scriptFor(pdf, mark.style ?? 'flowing', text)) ?? body;
      return writeCentred(page, font === body ? drawable(text) : text, font, b, ink, 0.95);
    };
    let bottom: number;
    if (SIGNED.has(field.kind) && mark !== null) {
      // The signature's own frame, as e-signature services stamp one: a thin
      // rule around it, "Signed by" and the name in small print along its
      // top, the ink below, so a printed page shows at a glance that this is
      // an electronic signature and whose.
      const head = STAMP_HEAD + 2;
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        borderColor: rgb(0.62, 0.66, 0.78),
        borderWidth: 0.6,
        opacity: 0,
        borderOpacity: 1,
      });
      page.drawText(drawable(`Signed by ${signer?.name ?? ''}`.slice(0, 60)), {
        x: box.x + 2,
        y: box.y + box.h - head + 1.5,
        size: STAMP_HEAD,
        font: body,
        color: rgb(0.42, 0.44, 0.5),
      });
      const inkBox = { ...box, h: box.h - head };
      if (field.kind === 'date') {
        // A dated signature: the signature over the box, the day right under it.
        const under = inkBox.h * 0.3;
        const signed = await stamp({ ...inkBox, y: inkBox.y + under, h: inkBox.h - under }, false);
        bottom = writeUnder(page, drawable(field.value), body, inkBox, signed - DAY_GAP, ink, 9);
      } else {
        bottom = await stamp(inkBox, field.kind === 'initials');
      }
      bottom = Math.min(bottom, box.y);
    } else {
      const text = field.kind === 'checkbox' ? (field.value === 'true' ? 'X' : '') : field.value;
      bottom = writeCentred(page, drawable(text), body, box, ink, 0.8, 12);
    }
    const trace = traces.get(field.signerId);
    if (trace !== undefined) {
      // TRACE_GAP under the ink: tight, as e-signature services print it.
      const cap = body.heightAtSize(TRACE_SIZE, { descender: false });
      const lead = TRACE_SIZE * 1.3;
      const first = Math.max(bottom - TRACE_GAP - cap, lead + 2);
      for (const [i, text] of traceLines(trace).entries()) {
        page.drawText(drawable(text), {
          x: box.x,
          y: first - i * lead,
          size: TRACE_SIZE,
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

/** The boxes a signature fills, framed and headed as one. */
const SIGNED: ReadonlySet<string> = new Set(['signature', 'initials', 'date']);
/** "Signed by …" along the top of a signature's frame. */
const STAMP_HEAD = 5;
/** The print under a signed field: its size, and the gap above it (6pt, 8px on screen). */
const TRACE_SIZE = 5.5;
const TRACE_GAP = 6;
/** Between a dated signature and its day. */
const DAY_GAP = 2;

/**
 * Text in the middle of its box, as large as fits: at most `fill` of the
 * box's height, and never wider than nine tenths of it. Answers where its
 * ink ends.
 */
function writeCentred(
  page: PDFPage,
  text: string,
  font: PDFFont,
  box: Box,
  color: RGB,
  fill: number,
  most = Infinity,
): number {
  if (text === '') return box.y + box.h / 2;
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
  const baseline = box.y + (box.h - full) / 2 + descent;
  page.drawText(text, {
    x: box.x + (box.w - font.widthOfTextAtSize(text, size)) / 2,
    y: baseline,
    size,
    font,
    color,
  });
  return inkBottom(font, text, size, baseline);
}

/**
 * Where the glyphs' ink really ends. A script face's descender is sized for
 * its deepest swash, so measuring by it leaves a gap under most names; the
 * fontkit face pdf-lib embedded lays the text out and knows.
 */
function inkBottom(font: PDFFont, text: string, size: number, baseline: number): number {
  const face = (font as unknown as { embedder?: { font?: Face } }).embedder?.font;
  const low = face?.layout(text).bbox.minY;
  if (face === undefined || low === undefined || !Number.isFinite(low)) {
    return baseline - (font.heightAtSize(size) - font.heightAtSize(size, { descender: false }));
  }
  return baseline + (low * size) / face.unitsPerEm;
}

interface Face {
  readonly unitsPerEm: number;
  layout(text: string): { readonly bbox: { readonly minY: number } };
}

/**
 * A line centred across the box with its top at `top`: the day under a
 * dated signature, close under its ink. Answers where its ink ends.
 */
function writeUnder(
  page: PDFPage,
  text: string,
  font: PDFFont,
  box: Box,
  top: number,
  color: RGB,
  size: number,
): number {
  if (text === '') return top;
  const ascent = font.heightAtSize(size, { descender: false });
  const baseline = top - ascent;
  page.drawText(text, {
    x: box.x + (box.w - font.widthOfTextAtSize(text, size)) / 2,
    y: baseline,
    size,
    font,
    color,
  });
  return inkBottom(font, text, size, baseline);
}

/**
 * A drawn signature's ink in the middle of its box, scaled to fit with a
 * margin: the pad's own 400 × 120 frame and the blank around the strokes
 * are not part of the signature.
 */
function drawCentred(page: PDFPage, path: string, box: Box, color: RGB): number {
  const ink = inkBounds(path);
  if (ink === null) return box.y + box.h / 2;
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
  // The strokes' foot, as drawn.
  return top - ink.height * scale;
}

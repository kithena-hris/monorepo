import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

import type { Envelope } from '../domain/signature/envelope.js';
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

export async function seal(
  original: Uint8Array,
  envelope: Envelope,
  trail: readonly EnvelopeEvent[],
  company: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const script = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.12, 0.16, 0.36);
  const pages = pdf.getPages();
  for (const field of envelope.fields) {
    const page = pages[field.page - 1];
    if (page === undefined || field.value === null || field.value === undefined) continue;
    const { width, height } = page.getSize();
    const x = field.x * width;
    const boxH = field.h * height;
    // PDF's origin is the bottom left; a field's is the top left.
    const y = height - field.y * height - boxH;
    const signer = envelope.signers.find((s) => s.id === field.signerId);
    if ((field.kind === 'signature' || field.kind === 'initials') && signer?.signature != null) {
      const mark = signer.signature;
      if (mark.kind === 'drawn') {
        const png = await pdf.embedPng(
          Buffer.from(mark.image.slice('data:image/png;base64,'.length), 'base64'),
        );
        const scale = Math.min((field.w * width) / png.width, boxH / png.height);
        page.drawImage(png, { x, y, width: png.width * scale, height: png.height * scale });
      } else {
        const text = field.kind === 'initials' ? initials(mark.text) : mark.text;
        page.drawText(text, {
          x: x + 2,
          y: y + boxH * 0.2,
          size: Math.max(10, boxH * 0.7),
          font: script,
          color: ink,
        });
      }
    } else {
      const text = field.kind === 'checkbox' ? (field.value === 'true' ? 'X' : '') : field.value;
      page.drawText(text, {
        x: x + 2,
        y: y + boxH * 0.2,
        size: Math.max(8, Math.min(12, boxH * 0.7)),
        font: body,
        color: ink,
      });
    }
  }

  const page = pdf.addPage([595, 842]);
  let y = 780;
  const line = (text: string, size = 10, font = body) => {
    page.drawText(text.slice(0, 110), { x: 56, y, size, font, color: rgb(0.15, 0.15, 0.2) });
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

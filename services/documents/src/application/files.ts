import { createHash } from 'node:crypto';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * What Documents reads from and draws onto a file: a checksum, a PDF's page
 * count, and the viewer's watermark on a Confidential copy (PRD §9.2).
 *
 * pdf-lib because nothing installed edits an existing PDF: Time Off's pdfkit
 * only writes new ones. It is pure JavaScript, so the image needs nothing
 * native.
 */

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Pages in a PDF; null for anything else, or a PDF pdf-lib cannot read. */
export async function pageCount(bytes: Uint8Array, mediaType: string): Promise<number | null> {
  if (mediaType !== 'application/pdf') return mediaType.startsWith('image/') ? 1 : null;
  try {
    return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    return null;
  }
}

/**
 * What the standard fonts can draw: Latin-1 and the few WinAnsi extras.
 * ponytail: anything else becomes "?"; embed a Unicode font (fontkit) when a
 * customer's names are outside Latin-1.
 */
export const drawable = (text: string): string =>
  [...text].map((c) => (c.charCodeAt(0) <= 0xff || '•–—‘’“”€…'.includes(c) ? c : '?')).join('');

/** Media types a watermarked copy can be drawn for; the rest are not shown inline. */
export const watermarkable = (mediaType: string): boolean =>
  mediaType === 'application/pdf' || mediaType === 'image/jpeg' || mediaType === 'image/png';

/**
 * A PDF with `line` tiled diagonally across every page. An image becomes a
 * one-page PDF of itself first, so the original image never leaves.
 */
export async function watermark(
  bytes: Uint8Array,
  mediaType: string,
  line: string,
): Promise<Uint8Array> {
  let pdf: PDFDocument;
  if (mediaType === 'application/pdf') {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } else {
    pdf = await PDFDocument.create();
    const image = mediaType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = drawable(`${line}  ·  ${line}`);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(10, Math.round(width * 0.03));
    const step = size * 7;
    for (let y = -height; y < height * 2; y += step) {
      page.drawText(text, {
        x: -width * 0.2,
        y,
        size,
        font,
        color: rgb(0.3, 0.32, 0.4),
        opacity: 0.16,
        rotate: degrees(28),
      });
    }
  }
  return pdf.save();
}

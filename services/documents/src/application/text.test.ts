import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { signatureLines } from './text.js';

describe('where a document says to sign (K2)', () => {
  it('finds each signature label, in reading order, as fractions of its page', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([600, 800]).drawText('Terms of employment', { x: 50, y: 750, font, size: 12 });
    const last = doc.addPage([600, 800]);
    last.drawText('Signature: ________', { x: 50, y: 200, font, size: 12 });
    last.drawText('Signed by the company', { x: 320, y: 120, font, size: 12 });
    const lines = await signatureLines(await doc.save());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ page: 2 });
    expect(lines[0]?.y).toBeCloseTo(1 - (200 + 24) / 800, 2);
    expect(lines[1]?.x).toBeGreaterThan(0.5);
  });

  it('has none in a file that is not a PDF', async () => {
    expect(await signatureLines(new TextEncoder().encode('not a pdf'))).toEqual([]);
  });
});

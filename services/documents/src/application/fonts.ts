import { readFile } from 'node:fs/promises';

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

/**
 * The faces a sealed copy and a watermark are drawn in: Noto Sans (OFL,
 * `assets/fonts`), embedded and subset, so a signer called Łukasz, Ольга or
 * Nguyễn is drawn as written. A character no face has — CJK among them —
 * becomes "?" rather than an empty box.
 *
 * ponytail: Latin, Greek and Cyrillic only; add Noto Sans CJK (16 MB) when a
 * customer signs in Chinese, Japanese or Korean.
 */

const FONTS = new URL('../../assets/fonts/', import.meta.url);

let files: Promise<{ body: Uint8Array; bold: Uint8Array; script: Uint8Array }> | undefined;
const load = () =>
  (files ??= Promise.all(
    ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf', 'NotoSans-Italic.ttf'].map(
      async (name) => new Uint8Array(await readFile(new URL(name, FONTS))),
    ),
  ).then(([body, bold, script]) => {
    if (body === undefined || bold === undefined || script === undefined) {
      throw new Error('The fonts are missing');
    }
    return { body, bold, script };
  }));

export interface Faces {
  readonly body: PDFFont;
  readonly bold: PDFFont;
  readonly script: PDFFont;
  /** The text as these faces can draw it. */
  readonly drawable: (text: string) => string;
}

export async function facesFor(pdf: PDFDocument): Promise<Faces> {
  const { body, bold, script } = await load();
  pdf.registerFontkit(fontkit);
  const glyphs = fontkit.create(body);
  return {
    body: await pdf.embedFont(body, { subset: true }),
    bold: await pdf.embedFont(bold, { subset: true }),
    script: await pdf.embedFont(script, { subset: true }),
    drawable: (text) =>
      Array.from(text, (c) =>
        glyphs.hasGlyphForCodePoint(c.codePointAt(0) ?? 0) || /\s/u.test(c) ? c : '?',
      ).join(''),
  };
}

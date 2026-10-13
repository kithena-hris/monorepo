import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import fontkit from '@pdf-lib/fontkit';
import type { SignatureStyle } from '@kithena/contracts';
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

/**
 * `assets/fonts` at the package's root, found from wherever this file runs:
 * `src/application` in tests, `dist/src/application` once built (the build's
 * root is the package, so the compiled file sits a folder deeper).
 */
const FONTS = (() => {
  for (const up of ['../../', '../../../']) {
    const dir = new URL(`${up}assets/fonts/`, import.meta.url);
    if (existsSync(dir)) return dir;
  }
  return new URL('../../assets/fonts/', import.meta.url);
})();

let files: Promise<{ body: Uint8Array; bold: Uint8Array }> | undefined;
const read = async (name: string) => new Uint8Array(await readFile(new URL(name, FONTS)));
const load = () =>
  (files ??= Promise.all(['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'].map(read)).then(
    ([body, bold]) => {
      if (body === undefined || bold === undefined) throw new Error('The fonts are missing');
      return { body, bold };
    },
  ));

export interface Faces {
  readonly body: PDFFont;
  readonly bold: PDFFont;
  /** The text as these faces can draw it. */
  readonly drawable: (text: string) => string;
}

export async function facesFor(pdf: PDFDocument): Promise<Faces> {
  const { body, bold } = await load();
  pdf.registerFontkit(fontkit);
  const glyphs = fontkit.create(body);
  return {
    body: await pdf.embedFont(body, { subset: true }),
    bold: await pdf.embedFont(bold, { subset: true }),
    drawable: (text) =>
      Array.from(text, (c) =>
        glyphs.hasGlyphForCodePoint(c.codePointAt(0) ?? 0) || /\s/u.test(c) ? c : '?',
      ).join(''),
  };
}

/** The handwriting face of each signature style (`@kithena/contracts`, `SIGNATURE_STYLES`). */
const SCRIPTS: Readonly<Record<SignatureStyle, string>> = {
  flowing: 'GreatVibes-Regular.ttf',
  light: 'Sacramento-Regular.ttf',
  bold: 'MrDafoe-Regular.ttf',
};
const scripts = new Map<SignatureStyle, Promise<Uint8Array>>();

/**
 * A typed signature's face, embedded once per sealed copy and only for the
 * styles its signers chose; null when the face cannot write the name (a
 * script it has no letters for), so the caller falls back to Noto Sans.
 */
export async function scriptFor(
  pdf: PDFDocument,
  style: SignatureStyle,
  text: string,
): Promise<PDFFont | null> {
  let bytes = scripts.get(style);
  if (bytes === undefined) {
    bytes = read(SCRIPTS[style]);
    scripts.set(style, bytes);
  }
  const file = await bytes;
  const glyphs = fontkit.create(file);
  const writes = Array.from(text).every(
    (c) => /\s/u.test(c) || glyphs.hasGlyphForCodePoint(c.codePointAt(0) ?? 0),
  );
  if (!writes) return null;
  pdf.registerFontkit(fontkit);
  return pdf.embedFont(file, { subset: true });
}

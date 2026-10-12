import { extractText, getDocumentProxy } from 'unpdf';

import type { Reader } from './ports.js';

/**
 * A file's text, page by page, for Kithena to read (PRD §14): a PDF's by
 * code, an image's (a phone's scan or photo) as a model that sees transcribes
 * it, one page. Remembered per file, by checksum, for the process.
 *
 * ponytail: a hundred files in memory; keep extracted text in Postgres
 * against the version when the same documents are asked about all day.
 */
const kept = new Map<string, readonly string[]>();

/** What a model that sees is sent at most: the providers' own limit for an inline image. */
const MAX_IMAGE = 4 * 1024 * 1024;
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function pagesOf(
  bytes: Uint8Array,
  mediaType: string,
  checksum: string,
  reader?: Reader,
): Promise<readonly string[] | null> {
  const known = kept.get(checksum);
  if (known !== undefined) return known;
  if (IMAGES.has(mediaType)) {
    if (reader?.see === undefined || bytes.length > MAX_IMAGE) return null;
    const text = await reader.see({
      instruction:
        'Transcribe every word in this image exactly as written, line by line, keeping numbers and dates as they appear. Reply with the text only.',
      image: { mediaType, bytes },
    });
    if (text === null) return null;
    remember(checksum, [text.trim()]);
    return [text.trim()];
  }
  if (mediaType !== 'application/pdf') return null;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t) =>
      t.replaceAll(/[ \t]+/gu, ' ').trim(),
    );
    remember(checksum, pages);
    return pages;
  } catch {
    return null;
  }
}

function remember(checksum: string, pages: readonly string[]): void {
  if (kept.size >= 100) kept.delete(kept.keys().next().value ?? '');
  kept.set(checksum, pages);
}

/** Pages as the model is shown them: numbered, each and all of them bounded. */
export function forModel(
  pages: readonly string[],
  perPage = 3000,
  total = 24_000,
): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  let used = 0;
  for (const [i, text] of pages.entries()) {
    if (used >= total) break;
    const t = text.slice(0, Math.min(perPage, total - used));
    used += t.length;
    out.push({ page: i + 1, text: t });
  }
  return out;
}

/** "Signature", "Signed by", "Sign here", and the same in the languages the packs ship. */
const SIGN_HERE = /^(signature|signed|sign here|firma|unterschrift|signature du|assinatura)\b/iu;

/**
 * Where a PDF says to sign (K2): each line that starts like a signature
 * label, in reading order, as fractions of its page from the top left. A
 * file that is not a PDF, or one with no such line, has none.
 */
export async function signatureLines(
  bytes: Uint8Array,
): Promise<{ page: number; x: number; y: number }[]> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out: { page: number; x: number; y: number }[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      // eslint-disable-next-line no-await-in-loop -- pages in order, a few of them
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      // eslint-disable-next-line no-await-in-loop -- as above
      const content = await page.getTextContent();
      const found = content.items.flatMap((item) => {
        if (!('str' in item) || !SIGN_HERE.test(item.str.trim())) return [];
        const [, , , , tx = 0, ty = 0] = item.transform as number[];
        // Beside the label, a little above its baseline: where a hand would sign.
        return [{ page: n, x: (tx + item.width + 8) / width, y: 1 - (ty + 24) / height }];
      });
      out.push(...found.toSorted((a, b) => a.y - b.y || a.x - b.x));
    }
    return out;
  } catch {
    return [];
  }
}

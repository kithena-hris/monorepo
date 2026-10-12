import { extractText, getDocumentProxy } from 'unpdf';

/**
 * A PDF's text, page by page, for Kithena to read (PRD §14). Nothing else is
 * read: an image has no text without a model that sees, which the configured
 * one does not. Remembered per file, by checksum, for the process.
 *
 * ponytail: a hundred files in memory; keep extracted text in Postgres
 * against the version when the same documents are asked about all day.
 */
const kept = new Map<string, readonly string[]>();

export async function pagesOf(
  bytes: Uint8Array,
  mediaType: string,
  checksum: string,
): Promise<readonly string[] | null> {
  if (mediaType !== 'application/pdf') return null;
  const known = kept.get(checksum);
  if (known !== undefined) return known;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t) =>
      t.replaceAll(/[ \t]+/gu, ' ').trim(),
    );
    if (kept.size >= 100) kept.delete(kept.keys().next().value ?? '');
    kept.set(checksum, pages);
    return pages;
  } catch {
    return null;
  }
}

/** Pages as the model is shown them: numbered, each and all of them bounded. */
export function forModel(pages: readonly string[], perPage = 3000, total = 24_000) {
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

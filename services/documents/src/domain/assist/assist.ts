/**
 * What Documents checks around a model (PRD §14): every page it cites
 * exists, a medical document is read for dates by code alone, a version
 * compare is a diff the code computed, and a question across documents is
 * answered from passages the code chose among what the asker may open.
 */

export interface Cited {
  readonly text: string;
  readonly pages: readonly number[];
}

/** Claims whose cited pages are real; a claim citing none left is dropped. */
export function keepCited<T extends Cited>(items: readonly T[], pageCount: number): T[] {
  return items.flatMap((item) => {
    const pages = [...new Set(item.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount))];
    return pages.length === 0 || item.text.trim() === '' ? [] : [{ ...item, pages }];
  });
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) =>
  y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** ISO dates in text, in the order they appear, each once: dd/mm/yyyy, yyyy-mm-dd, 9 October 2026. */
export function datesIn(text: string): string[] {
  const found: { at: number; iso: string }[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/gu)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (valid(y, mo, d)) found.push({ at: m.index ?? 0, iso: `${String(y)}-${pad(mo)}-${pad(d)}` });
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (valid(y, mo, d)) found.push({ at: m.index ?? 0, iso: `${String(y)}-${pad(mo)}-${pad(d)}` });
  }
  for (const m of text.matchAll(/\b(\d{1,2}) ([A-Za-z]+) (\d{4})\b/gu)) {
    const mo = MONTHS.indexOf((m[2] ?? '').toLowerCase()) + 1;
    const [d, y] = [Number(m[1]), Number(m[3])];
    if (mo > 0 && valid(y, mo, d)) found.push({ at: m.index ?? 0, iso: `${String(y)}-${pad(mo)}-${pad(d)}` });
  }
  return [...new Set(found.toSorted((a, b) => a.at - b.at).map((f) => f.iso))];
}

/** Lines in one version and not the other, blank space ignored. */
export function changedLines(before: readonly string[], after: readonly string[]) {
  const clean = (lines: readonly string[]) => lines.map((l) => l.replaceAll(/\s+/gu, ' ').trim()).filter(Boolean);
  const a = clean(before);
  const b = clean(after);
  const inA = new Set(a);
  const inB = new Set(b);
  return { removed: a.filter((l) => !inB.has(l)), added: b.filter((l) => !inA.has(l)) };
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'do', 'does', 'i', 'my', 'me', 'how', 'what', 'when', 'much', 'many', 'can', 'get', 'it', 'be', 'with', 'by', 'at', 'from']);
const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^a-z0-9]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));

export interface Passage {
  readonly documentId: string;
  readonly title: string;
  readonly page: number;
  readonly text: string;
  readonly score: number;
}

/**
 * The pages most worth reading for a question: by shared words, a title's
 * words counting double. ponytail: keyword overlap, not embeddings; pgvector
 * is installed for when a company's library outgrows it.
 */
export function passages(
  question: string,
  docs: readonly { documentId: string; title: string; pages: readonly string[] }[],
  limit: number,
): Passage[] {
  const asked = new Set(words(question));
  const out: Passage[] = [];
  for (const d of docs) {
    const titleHits = words(d.title).filter((w) => asked.has(w)).length;
    d.pages.forEach((text, i) => {
      const hits = new Set(words(text).filter((w) => asked.has(w))).size;
      const score = hits + titleHits * 2;
      if (hits > 0) out.push({ documentId: d.documentId, title: d.title, page: i + 1, text, score });
    });
  }
  return out.toSorted((a, b) => b.score - a.score).slice(0, limit);
}

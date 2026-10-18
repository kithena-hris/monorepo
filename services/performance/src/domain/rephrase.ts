/**
 * Rewriting a writer's words without losing what they made (§13.7): pure, so
 * the rules are tested without a model. A flag's rewrite is a sentence, never
 * advice; a rephrase keeps every link where it pointed and the lists and marks
 * the writer used, or is not used at all.
 */

/**
 * A rewrite that is advice after all ("Add specific examples…") is dropped:
 * putting it in the draft would paste an instruction into a review.
 */
const ADVICE =
  /^(add|consider|include|try|replace|use|mention|provide|give|be (more|less)|avoid|remove|rephrase|reword|describe|explain|focus|specify|clarify|state|list|quantify)\b/iu;
export function mended<
  F extends { sentence: string; advice: string | null; rewrite: string | null },
>(f: F): F {
  const r = f.rewrite?.trim() ?? null;
  const usable =
    r !== null && r !== '' && !ADVICE.test(r) && r !== f.advice?.trim() && r !== f.sentence.trim();
  return { ...f, rewrite: usable ? r : null };
}

/** What the editor writes, and so all a rephrase may give back. */
const KEPT_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'ul',
  'ol',
  'li',
]);
const STRUCTURE = ['ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'code'] as const;

/**
 * Links out, markers in: each `<a …>text</a>` becomes `⟦n⟧text⟦/n⟧`, so the
 * model can reword a link's text but never sees, drops or edits where it goes.
 */
export function protectLinks(html: string): { text: string; links: string[] } {
  const links: string[] = [];
  const text = html.replaceAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu, (whole, inner: string) => {
    links.push(/^<a\b[^>]*>/iu.exec(whole)?.[0] ?? '<a>');
    return `⟦${String(links.length)}⟧${inner}⟦/${String(links.length)}⟧`;
  });
  return { text, links };
}

/**
 * Only the editor's own tags, bare: anything else the model wrote is dropped,
 * its words kept. Dropped until nothing changes, so a tag cannot survive by
 * being assembled from the pieces round one that was taken out; then any `<`
 * left that does not open one of those bare tags is escaped as text.
 */
function keptTagsOnly(html: string): string {
  const one = (tag: string, name: string): string => {
    // <b> and <i> are the editor's <strong> and <em>, whichever the model wrote.
    const n =
      ({ b: 'strong', i: 'em' } as Record<string, string>)[name.toLowerCase()] ??
      name.toLowerCase();
    if (!KEPT_TAGS.has(n)) return '';
    return tag.startsWith('</') ? `</${n}>` : n === 'br' ? '<br>' : `<${n}>`;
  };
  let text = html;
  for (let before = ''; before !== text;) {
    before = text;
    text = text.replaceAll(/<\/?([a-z0-9]+)\b[^>]*>/giu, one);
  }
  const bare = new RegExp(`^</?(${[...KEPT_TAGS].join('|')})>`, 'u');
  return text.replaceAll(/</gu, (lt, at: number) => (bare.test(text.slice(at)) ? lt : '&lt;'));
}

const countOf = (html: string, tag: string): number =>
  (html.match(new RegExp(`<${tag}>`, 'giu')) ?? []).length;

/**
 * The model's answer with its links put back, or null when it lost one, made
 * one up, or changed the lists and marks the writer used: a rephrase that
 * changes the shape of the answer is not kept.
 */
export function restored(answer: string, links: readonly string[], before: string): string | null {
  let html = keptTagsOnly(answer);
  for (const [i, open] of links.entries()) {
    const n = String(i + 1);
    const start = `⟦${n}⟧`;
    const end = `⟦/${n}⟧`;
    if (html.split(start).length !== 2 || html.split(end).length !== 2) return null;
    html = html.replace(start, open).replace(end, '</a>');
  }
  if (/⟦\/?\d+⟧/u.test(html)) return null;
  const shape = keptTagsOnly(before);
  return STRUCTURE.every((t) => countOf(html, t) === countOf(shape, t)) ? html : null;
}

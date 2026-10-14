/**
 * A letter from a template (G3): the template's `{{Field}}` placeholders,
 * each filled from one person's record. Pure; who may read a value is the
 * record's business, decided before a value arrives here.
 */

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/gu;

/** Each field a template asks for, once, in the order it first appears. */
export function placeholders(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => m[1] ?? ''))].filter(Boolean);
}

/** The template with every value it has filled in; a field with none stays, and is named. */
export function merge(
  text: string,
  values: Readonly<Record<string, string>>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const filled = text.replaceAll(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    if (value === undefined || value.trim() === '') {
      missing.add(name);
      return `{{${name}}}`;
    }
    return value;
  });
  return { text: filled, missing: [...missing] };
}

/**
 * Where each signer of a drafted document signs (PRD §14.2, "Draft a
 * document"): a "Signature:" line and their name under it, one per signer in
 * signing order, at the end. Kithena writes it, never the model, and
 * `signatureLines` then finds each line, so every signer's box lands beside
 * their own, in order.
 */
export function signingBlock(names: readonly string[]): string {
  return names.map((name) => `\n\n\nSignature:\nName: ${name}`).join('');
}

const FIGURE = /\d+(?:[.,]\d+)*/gu;
const figures = (text: string): string[] =>
  Array.from(text.matchAll(FIGURE), (m) => m[0].replaceAll(',', ''));

/**
 * The figures a model wrote that nobody gave it, each once (PRD §14.1: the
 * domain, not a model, answers for every number). `85,000` and `85000` are
 * one figure; the sender is shown the rest to check before anything is sent.
 */
export function figuresToCheck(draft: string, said: string): string[] {
  const known = new Set(figures(said));
  return [...new Set(figures(draft))].filter((f) => !known.has(f));
}

const words = (name: string): string[] => name.toLowerCase().split(/\s+/u).filter(Boolean);

/**
 * The one person a name means: the same name, else the only one whose name
 * has every word of it. Two who could be meant is `ambiguous`, and the
 * sender is asked which, never guessed for.
 */
export function matchName<T extends { readonly displayName: string }>(
  name: string,
  people: readonly T[],
): T | 'ambiguous' | null {
  const asked = words(name);
  if (asked.length === 0) return null;
  const same = people.filter((p) => words(p.displayName).join(' ') === asked.join(' '));
  if (same.length === 1) return same[0] ?? null;
  if (same.length > 1) return 'ambiguous';
  const close = people.filter((p) => asked.every((w) => words(p.displayName).includes(w)));
  if (close.length > 1) return 'ambiguous';
  return close[0] ?? null;
}

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

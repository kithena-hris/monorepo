/**
 * Words in a language, for what a service writes outside any screen: an
 * email's subject, its lines, its button.
 *
 * The same contract as a screen's `t` (`@reach/ui`'s, which a service may not
 * import): `t(key, 'English {{name}}', vars)`, or a plural as
 * `t(key, { one, other }, { count })`, whose form is the language's own
 * (`Intl.PluralRules`), so Polish gets its four. A key a language has no words
 * for reads in English, so a message is never a row of keys.
 */

export interface Plural {
  readonly one: string;
  readonly other: string;
}

export type WordVars = Readonly<Record<string, string | number | null | undefined>>;

export type Words = (key: string, fallback: string | Plural, vars?: WordVars) => string;

export type Catalogue = Readonly<Record<string, string>>;

const numbers = new Map<string, Intl.NumberFormat>();
const plurals = new Map<string, Intl.PluralRules>();

function cached<V>(map: Map<string, V>, language: string, make: () => V): V {
  let v = map.get(language);
  if (v === undefined) {
    v = make();
    map.set(language, v);
  }
  return v;
}

/** `{{name}}` filled in; a number in the language's own digits. */
export function fill(text: string, vars: WordVars | undefined, language: string): string {
  if (vars === undefined) return text;
  return text.replaceAll(/\{\{\s*([\w.]+)\s*\}\}/gu, (whole, name: string) => {
    if (!Object.hasOwn(vars, name)) return whole;
    const value = vars[name];
    return typeof value === 'number'
      ? cached(
          numbers,
          language,
          () => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }),
        ).format(value)
      : String(value ?? '');
  });
}

/** A translator for one language over one catalogue. */
export function wordsIn(language: string, catalogue: Catalogue): Words {
  const rules = cached(plurals, language, () => new Intl.PluralRules(language));
  const english = cached(plurals, 'en', () => new Intl.PluralRules('en'));
  return (key, fallback, vars) => {
    if (typeof fallback === 'string') return fill(catalogue[key] ?? fallback, vars, language);
    const count = Number(vars?.['count'] ?? 0);
    const form = rules.select(count);
    const own = catalogue[`${key}_${form}`] ?? catalogue[`${key}_other`];
    if (own !== undefined) return fill(own, vars, language);
    return fill(english.select(count) === 'one' ? fallback.one : fallback.other, vars, 'en-US');
  };
}

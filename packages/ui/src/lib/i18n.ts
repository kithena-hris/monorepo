/**
 * Words on a screen, in the reader's language, without the design system
 * knowing which languages there are or where the words come from.
 *
 * Every string a screen shows is written as `t(key, fallback, vars)`: a key
 * that names it, the words in English, and the values that go into it
 * (`{{name}}`). An app hands Reach the one function that looks a key up
 * (`setTranslate`); until it does, and for any key it does not know, the
 * English is shown, so a screen is never a row of keys. Reach's own words
 * go through the same function under the namespace `reach`.
 *
 * Words that change with a number are one message with its forms,
 * `t(key, { one: '{{count}} day', other: '{{count}} days' }, { count })`,
 * never a sentence with an English word slotted in: which form a number
 * takes is the language's (`Intl.PluralRules`), and Polish has four.
 *
 * One function for the page, because Reach is one copy on the page: the
 * app's and every remote's screens share it.
 */
import { formatNumber } from './intl';

/** What goes into a message; nothing (`null`, `undefined`) goes in as nothing, as in JSX. */
export type TranslateVars = Readonly<Record<string, string | number | null | undefined>>;

/**
 * A message whose words follow a number, `vars.count`: English's two forms,
 * from which every language is translated into as many as its grammar has.
 */
export interface Plural {
  readonly one: string;
  readonly other: string;
}

/** Looks a key up in a namespace; answers `fallback` with the values filled in when it has none. */
export type Translate = (
  namespace: string,
  key: string,
  fallback: string | Plural,
  vars?: TranslateVars,
) => string;

export type T = (key: string, fallback: string | Plural, vars?: TranslateVars) => string;

/** `{{name}}` replaced by the value of `name`; a placeholder with no value stays as it is. */
export function interpolate(text: string, vars?: TranslateVars): string {
  if (vars === undefined) return text;
  return text.replaceAll(/\{\{\s*([\w.]+)\s*\}\}/gu, (whole, name: string) => {
    if (!Object.hasOwn(vars, name)) return whole;
    const value = vars[name];
    // A number reads in the page's digits: 1,234 · 1.234 · १,२३४. A year is passed as a string.
    return typeof value === 'number'
      ? formatNumber(value, { maximumFractionDigits: 2 })
      : String(value ?? '');
  });
}

const english = new Intl.PluralRules('en');

/** The English form for `vars.count`, filled in: what shows before, or without, a translation. */
export function englishOf(fallback: string | Plural, vars?: TranslateVars): string {
  if (typeof fallback === 'string') return interpolate(fallback, vars);
  const form = english.select(Number(vars?.['count'] ?? 0)) === 'one' ? 'one' : 'other';
  return interpolate(fallback[form], vars);
}

let source: Translate | null = null;

/** The app's lookup, for every screen on the page; `null` goes back to English. */
export function setTranslate(next: Translate | null): void {
  source = next;
}

/** The `t` for one namespace: a remote's, the app's, or Reach's own. */
export function translator(namespace: string): T {
  return (key, fallback, vars) =>
    source === null ? englishOf(fallback, vars) : source(namespace, key, fallback, vars);
}

/** Reach's own words: a close button's name, an empty list's line. */
export const t = translator('reach');

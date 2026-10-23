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
 * One function for the page, because Reach is one copy on the page: the
 * app's and every remote's screens share it.
 */

/** What goes into a message; nothing (`null`, `undefined`) goes in as nothing, as in JSX. */
export type TranslateVars = Readonly<Record<string, string | number | null | undefined>>;

/** Looks a key up in a namespace; answers `fallback` with the values filled in when it has none. */
export type Translate = (
  namespace: string,
  key: string,
  fallback: string,
  vars?: TranslateVars,
) => string;

export type T = (key: string, fallback: string, vars?: TranslateVars) => string;

/** `{{name}}` replaced by the value of `name`; a placeholder with no value stays as it is. */
export function interpolate(text: string, vars?: TranslateVars): string {
  if (vars === undefined) return text;
  return text.replaceAll(/\{\{\s*([\w.]+)\s*\}\}/gu, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name] ?? '') : whole,
  );
}

let source: Translate | null = null;

/** The app's lookup, for every screen on the page; `null` goes back to English. */
export function setTranslate(next: Translate | null): void {
  source = next;
}

/** The `t` for one namespace: a remote's, the app's, or Reach's own. */
export function translator(namespace: string): T {
  return (key, fallback, vars) =>
    source === null ? interpolate(fallback, vars) : source(namespace, key, fallback, vars);
}

/** Reach's own words: a close button's name, an empty list's line. */
export const t = translator('reach');

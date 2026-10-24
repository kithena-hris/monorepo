import 'server-only';
import { setTranslate, type T } from '@reach/ui/i18n';
import { setLocale } from '@reach/ui/intl';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';

import { CATALOGUE } from '../locales';
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_KEY, LANGUAGES, type Language } from './languages';
import { wordsIn } from './words';

/**
 * Words in a server component, in the language of the request it renders.
 *
 * A client component's `t` asks the tree it renders in (`i18n.tsx`); a
 * server component has no such tree — React context does not reach it — so
 * its `t` (Reach's, in the server components' own copy of Reach) asks the
 * request instead: the language the root layout settled on for it, else the
 * cookie the request carries, else US English. Next keeps the request in an
 * `AsyncLocalStorage` for the length of the render, which is how a render
 * for one person never reads another's language.
 *
 * Every language's words are loaded once, as this module is, so a lookup in
 * the middle of a render never waits.
 */

type Words = Readonly<Record<string, Readonly<Record<string, string>>>>;

const words = new Map<Language, Words>(
  await Promise.all(
    LANGUAGES.map(async ({ code }) => {
      const loaders = CATALOGUE[code] ?? {};
      const loaded = await Promise.all(
        Object.entries(loaders).map(async ([ns, load]) => [ns, (await load()).default] as const),
      );
      return [code, Object.fromEntries(loaded)] as const;
    }),
  ),
);

/** The request each render belongs to, with the language the layout settled on. */
const settled = new WeakMap<object, Language>();

function store(): object | undefined {
  return workUnitAsyncStorage.getStore() as object | undefined;
}

/** The root layout's answer for this request (cookie, account, or US English), kept for its pages. */
export function settle(language: Language): void {
  const s = store();
  if (s !== undefined) settled.set(s, language);
}

function language(): Language {
  const s = store();
  if (s === undefined) return DEFAULT_LANGUAGE;
  const held = settled.get(s);
  if (held !== undefined) return held;
  const cookies: unknown = Reflect.get(s, 'cookies');
  const get =
    cookies !== null && typeof cookies === 'object' ? Reflect.get(cookies, 'get') : undefined;
  if (typeof get !== 'function') return DEFAULT_LANGUAGE;
  const cookie: unknown = (get as (name: string) => { value?: string } | undefined).call(
    cookies,
    LANGUAGE_KEY,
  )?.value;
  return isLanguage(cookie) ? cookie : DEFAULT_LANGUAGE;
}

const translators = new Map<string, T>();

setLocale(language);
setTranslate((ns, key, fallback, vars) => {
  const lang = language();
  const id = `${lang}|${ns}`;
  let t = translators.get(id);
  if (t === undefined) {
    t = wordsIn(lang, words.get(lang)?.[ns] ?? {});
    translators.set(id, t);
  }
  return t(key, fallback, vars);
});

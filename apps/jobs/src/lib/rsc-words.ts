import 'server-only';
import { setTranslate, type T } from '@reach/ui/i18n';
import { setLocale } from '@reach/ui/intl';
import { LANGUAGES, type Language } from '@kithena/contracts/language';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';

import { CATALOGUE } from '../locales';
import { LANGUAGE_KEY, languageOf, wordsIn, type PageWords } from './i18n';

/**
 * Words in a server component, in the language of the request it renders,
 * as the Kithena app does it (`apps/web/src/lib/rsc-words.ts`): React context
 * does not reach a server component, so its `t` asks the request, which Next
 * keeps in an `AsyncLocalStorage` for the length of the render. Every
 * language is loaded once, as this module is, so a lookup never waits.
 */

const words = new Map<Language, PageWords>(
  await Promise.all(
    LANGUAGES.map(async ({ code }) => {
      const load = CATALOGUE[code];
      const [jobs, reach] = await Promise.all([load?.jobs(), load?.reach()]);
      return [code, { jobs: jobs?.default ?? {}, reach: reach?.default ?? {} }] as const;
    }),
  ),
);

/** One language's words, for the page's client components. */
export const pageWords = (language: Language): PageWords =>
  words.get(language) ?? { jobs: {}, reach: {} };

function language(): Language {
  const s = workUnitAsyncStorage.getStore();
  if (s === undefined) return languageOf(null, null);
  const read = (name: string): ((key: string) => unknown) | undefined => {
    const bag: unknown = Reflect.get(s, name);
    const get: unknown =
      bag !== null && typeof bag === 'object' ? Reflect.get(bag, 'get') : undefined;
    return typeof get === 'function'
      ? (key) => (get as (k: string) => unknown).call(bag, key)
      : undefined;
  };
  const cookie: unknown = read('cookies')?.(LANGUAGE_KEY);
  const value: unknown =
    cookie !== null && typeof cookie === 'object' ? Reflect.get(cookie, 'value') : undefined;
  const accept = read('headers')?.('accept-language');
  return languageOf(
    typeof value === 'string' ? value : null,
    typeof accept === 'string' ? accept : null,
  );
}

const translators = new Map<string, T>();

setLocale(language);
setTranslate((ns, key, fallback, vars) => {
  const lang = language();
  const id = `${lang}|${ns}`;
  let t = translators.get(id);
  if (t === undefined) {
    t = wordsIn(lang, pageWords(lang)[ns === 'reach' ? 'reach' : 'jobs']);
    translators.set(id, t);
  }
  return t(key, fallback, vars);
});

/** The request's language, for `<html lang>` and the page's words. */
export const requestLanguage = language;

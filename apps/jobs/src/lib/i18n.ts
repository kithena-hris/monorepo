/**
 * Words on Kithena Jobs, in the reader's language. Every string a page shows
 * is `t(key, 'English', vars)`, as on every Kithena screen; the English is
 * what each language is translated from (`apps/web/scripts/i18n-translate.mjs`).
 *
 * A plain module: a server component's `t` answers from the request
 * (`rsc-words.ts`), a client component's from the page (`i18n-provider.tsx`).
 */
import {
  englishOf,
  interpolate,
  translator,
  type Plural,
  type T,
  type TranslateVars,
} from '@reach/ui/i18n';
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGES,
  type Language,
} from '@kithena/contracts/language';

export const t = translator('jobs');

/** The same cookie the Kithena app keeps a chosen language in. */
export const LANGUAGE_KEY = 'kithena-language';

/**
 * A candidate has no account to keep a choice in, so the language is the one
 * they chose here (the cookie), else the first their browser asks for that
 * Kithena speaks (`de-AT` reads as German), else US English.
 */
export function languageOf(cookie: string | null | undefined, accept: string | null): Language {
  if (isLanguage(cookie)) return cookie;
  const asked = (accept ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(
        params
          .find((p) => p.trim().startsWith('q='))
          ?.trim()
          .slice(2) ?? '1',
      );
      return { tag: tag.trim(), q: Number.isNaN(q) ? 0 : q };
    })
    .filter(({ tag, q }) => tag !== '' && q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of asked) {
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === tag.toLowerCase());
    if (exact !== undefined) return exact.code;
    const base = tag.split('-')[0]?.toLowerCase();
    if (base === 'en') return DEFAULT_LANGUAGE;
    const near = LANGUAGES.find((l) => l.code === base);
    if (near !== undefined) return near.code;
  }
  return DEFAULT_LANGUAGE;
}

/** A namespace's words in one language, by key. */
export type Words = Readonly<Record<string, string>>;
/** The job site's words and Reach's, in one language. */
export type PageWords = Readonly<Record<'jobs' | 'reach', Words>>;

/** A `t` over one namespace's words in a language: plurals by the language's own forms. */
export function wordsIn(language: string, words: Words): T {
  const rules = new Intl.PluralRules(language);
  return (key: string, fallback: string | Plural, vars?: TranslateVars): string => {
    const text =
      typeof fallback === 'string'
        ? words[key]
        : (words[`${key}_${rules.select(Number(vars?.['count'] ?? 0))}`] ?? words[`${key}_other`]);
    return text === undefined || text === '' ? englishOf(fallback, vars) : interpolate(text, vars);
  };
}

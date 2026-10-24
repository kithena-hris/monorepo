import { englishOf, interpolate, type Plural, type T, type TranslateVars } from '@reach/ui/i18n';

/** A `t` over one namespace's words in a language: the same lookup a page makes. */
export function wordsIn(language: string, words: Readonly<Record<string, string>>): T {
  const rules = new Intl.PluralRules(language);
  return (key: string, fallback: string | Plural, vars?: TranslateVars): string => {
    if (typeof fallback !== 'string') {
      const form = rules.select(Number(vars?.['count'] ?? 0));
      const text = words[`${key}_${form}`] ?? words[`${key}_other`];
      return text === undefined || text === ''
        ? englishOf(fallback, vars)
        : interpolate(text, vars);
    }
    const text = words[key];
    return text === undefined || text === ''
      ? interpolate(fallback, vars)
      : interpolate(text, vars);
  };
}

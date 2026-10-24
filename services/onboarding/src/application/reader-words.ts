import { readerLanguage } from '@kithena/auth-kit';
import { isLanguage, type Language } from '@kithena/contracts';
import { wordsIn, type Catalogue, type Words } from '@kithena/domain-kit';

import ca from '../locales/ca.json' with { type: 'json' };
import de from '../locales/de.json' with { type: 'json' };
import enGB from '../locales/en-GB.json' with { type: 'json' };
import enUS from '../locales/en-US.json' with { type: 'json' };
import es from '../locales/es.json' with { type: 'json' };
import fr from '../locales/fr.json' with { type: 'json' };
import hi from '../locales/hi.json' with { type: 'json' };
import it from '../locales/it.json' with { type: 'json' };
import nl from '../locales/nl.json' with { type: 'json' };
import pl from '../locales/pl.json' with { type: 'json' };
import pt from '../locales/pt.json' with { type: 'json' };
import ru from '../locales/ru.json' with { type: 'json' };
import ta from '../locales/ta.json' with { type: 'json' };

/** Onboarding's words in every language, translated from the English in the code. */
const CATALOGUES: Readonly<Record<Language, Catalogue>> = {
  'en-US': enUS,
  'en-GB': enGB,
  de,
  fr,
  es,
  it,
  ca,
  nl,
  pt,
  pl,
  ru,
  hi,
  ta,
};

const held = new Map<string, Words>();

/** The reader's language as a locale, for a date or a number beside the words. */
export function readerLocale(): Language {
  const said = readerLanguage();
  return said !== null && isLanguage(said) ? said : 'en-US';
}

/**
 * Onboarding's words for the person reading (`readerLanguage`): an Inbox task, a
 * refusal. US English outside a request, or for a language Kithena does not
 * speak. An email is written in the company's language instead (`mailWords`).
 */
export const t: Words = (key, fallback, vars) => {
  const language = readerLocale();
  let words = held.get(language);
  if (words === undefined) {
    words = wordsIn(language, CATALOGUES[language]);
    held.set(language, words);
  }
  return words(key, fallback, vars);
};

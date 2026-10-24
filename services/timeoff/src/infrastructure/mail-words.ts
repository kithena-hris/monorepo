import { isLanguage, type Language } from '@kithena/contracts';
import { wordsIn, type Catalogue } from '@kithena/domain-kit';

import ca from '../locales/ca.json' with { type: 'json' };
import de from '../locales/de.json' with { type: 'json' };
import enGB from '../locales/en-GB.json' with { type: 'json' };
import es from '../locales/es.json' with { type: 'json' };
import fr from '../locales/fr.json' with { type: 'json' };
import hi from '../locales/hi.json' with { type: 'json' };
import it from '../locales/it.json' with { type: 'json' };
import nl from '../locales/nl.json' with { type: 'json' };
import pl from '../locales/pl.json' with { type: 'json' };
import pt from '../locales/pt.json' with { type: 'json' };
import ru from '../locales/ru.json' with { type: 'json' };
import ta from '../locales/ta.json' with { type: 'json' };
import type { MailWords } from '../application/ports.js';

/** Time Off's email words in every language, translated from the English in the code. */
const CATALOGUES: Readonly<Record<Exclude<Language, 'en-US'>, Catalogue>> = {
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

const held = new Map<string, MailWords>();

function wordsFor(code: string): MailWords {
  const language = isLanguage(code) ? code : 'en-US';
  let words = held.get(language);
  if (words === undefined) {
    words = { language, t: wordsIn(language, language === 'en-US' ? {} : CATALOGUES[language]) };
    held.set(language, words);
  }
  return words;
}

/** A company changes its language rarely; a minute's wait for a new one is fine. */
const TTL_MS = 60_000;

/**
 * The company's language, as messaging answers it
 * (`/api/internal/messaging/language`), with the token Time Off sends email
 * with; US English when messaging cannot be asked.
 */
export function mailWords(config: { readonly baseUrl: string; readonly token: string }) {
  const cache = new Map<string, { readonly code: string; readonly until: number }>();
  return async (tenantId: string): Promise<MailWords> => {
    const now = Date.now();
    const kept = cache.get(tenantId);
    if (kept !== undefined && kept.until > now) return wordsFor(kept.code);
    const url = new URL('/api/internal/messaging/language', config.baseUrl);
    url.searchParams.set('tenantId', tenantId);
    const response = await fetch(url, {
      headers: { 'x-internal-token': config.token },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    const body =
      response?.ok === true
        ? ((await response.json().catch(() => null)) as { language?: unknown } | null)
        : null;
    const code = typeof body?.language === 'string' ? body.language : 'en-US';
    if (response?.ok === true) cache.set(tenantId, { code, until: now + TTL_MS });
    return wordsFor(code);
  };
}

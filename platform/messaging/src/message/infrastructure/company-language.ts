import { isLanguage, type Language as Code } from '@kithena/contracts';
import { wordsIn, type Catalogue } from '@kithena/domain-kit';

import ca from '../../locales/ca.json' with { type: 'json' };
import de from '../../locales/de.json' with { type: 'json' };
import enGB from '../../locales/en-GB.json' with { type: 'json' };
import es from '../../locales/es.json' with { type: 'json' };
import fr from '../../locales/fr.json' with { type: 'json' };
import hi from '../../locales/hi.json' with { type: 'json' };
import it from '../../locales/it.json' with { type: 'json' };
import nl from '../../locales/nl.json' with { type: 'json' };
import pl from '../../locales/pl.json' with { type: 'json' };
import pt from '../../locales/pt.json' with { type: 'json' };
import ru from '../../locales/ru.json' with { type: 'json' };
import ta from '../../locales/ta.json' with { type: 'json' };
import { ENGLISH, type Language } from '../domain/invitation.js';
import type { CompanyLanguage } from '../application/company-language.js';

/** Every language's words for messaging's own emails, translated from the English in the code. */
const CATALOGUES: Readonly<Record<Exclude<Code, 'en-US'>, Catalogue>> = {
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

const words = new Map<string, Language>();

/** A language's words, made once. */
export function languageOf(code: string): Language {
  if (!isLanguage(code) || code === 'en-US') return ENGLISH;
  let held = words.get(code);
  if (held === undefined) {
    held = { language: code, t: wordsIn(code, CATALOGUES[code]) };
    words.set(code, held);
  }
  return held;
}

/** A company changes its language rarely; a minute's wait for a new one is fine. */
const TTL_MS = 60_000;

/**
 * The company's language, as identity keeps it
 * (`/api/internal/tenants/<id>/language`), behind the internal token. US
 * English when identity cannot be asked, rather than no email.
 */
export function companyLanguage(config: {
  readonly baseUrl: string;
  readonly token: string;
}): CompanyLanguage {
  const cache = new Map<string, { readonly code: string; readonly until: number }>();
  return async (tenantId) => {
    const now = Date.now();
    const held = cache.get(tenantId);
    if (held !== undefined && held.until > now) return languageOf(held.code);
    const url = new URL(
      `/api/internal/tenants/${encodeURIComponent(tenantId)}/language`,
      config.baseUrl,
    );
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
    return languageOf(code);
  };
}

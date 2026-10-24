import type { T } from '@reach/ui';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGE_KEY,
  type Language,
  type Namespace,
} from './languages';
import { loadMessages } from './messages';
import { readPreference } from './preferences';
import { wordsIn } from './words';

/**
 * Words written on the server outside a page's render: a server action's
 * "That could not be saved", a download's file name, a route's refusal.
 *
 * A page's render asks `t` and React answers from the tree being rendered
 * (`i18n.tsx`); an action or a route has no tree, so it asks for the
 * request's language here, once per request, and gets a `t` bound to it.
 */

/**
 * The person's language: the one the phone says it is in, else the cookie this device keeps, else the one their
 * account keeps (identity's `language` preference), else their company's
 * (the back office's setting), else US English.
 */
export const requestLanguage = cache(async (): Promise<Language> => {
  // Outside a request (a test, a job) there is no cookie and no account: US English.
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch {
    return DEFAULT_LANGUAGE;
  }
  // The phone says which language its screens are in on every request.
  const asked = (await headers()).get('x-kithena-language');
  if (isLanguage(asked)) return asked;
  const cookie = jar.get(LANGUAGE_KEY)?.value;
  if (isLanguage(cookie)) return cookie;
  const kept = await readPreference('language').catch(() => null);
  const code: unknown =
    kept !== null && typeof kept === 'object' ? Reflect.get(kept, 'code') : null;
  if (isLanguage(code)) return code;
  // Nobody chose: the company's language, as its emails are.
  // Loaded here, not at the top: `branding` is server-only, and a test of an action has no tenant.
  const { currentTenant } = await import('./branding');
  return (await currentTenant().catch(() => null))?.language ?? DEFAULT_LANGUAGE;
});

/** A `t` that also says its language, for the dates and numbers written beside its words. */
export type ServerT = T & { readonly language: Language };

/**
 * The request's `t` for a namespace: `const t = await serverWords('shell')`,
 * and `t.language` for `Intl` (`toLocaleDateString(t.language, …)`).
 */
export async function serverWords(ns: Namespace = 'shell'): Promise<ServerT> {
  const language = await requestLanguage();
  const messages = await loadMessages(language, [ns]);
  return Object.assign(wordsIn(language, messages[ns] ?? {}), { language });
}

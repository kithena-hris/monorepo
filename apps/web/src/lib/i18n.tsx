'use client';

import { interpolate, setTranslate, type Translate, type TranslateVars } from '@reach/ui';
import { createInstance, type i18n as I18n } from 'i18next';
import { createContext, use, useEffect, useState, type JSX, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { VERSION } from '../locales';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_KEY,
  languageCookie,
  type Language,
  type Messages,
  type Namespace,
} from './languages';
import { loadMessages } from './messages';

/**
 * The page's language, and the i18next that holds its words (react-i18next's
 * provider gives it to anything that asks with `useTranslation`).
 *
 * Every screen writes `t(key, english, vars)` (`@reach/ui` `translator`); this
 * is what answers it. The English in the code is the fallback, so a key not
 * translated yet, or a namespace still loading, reads as English rather than
 * as a key.
 *
 * In the browser the page has one language, so one instance answers every
 * `t`, the remotes' included: Reach is one copy on the page. Changing the
 * language reloads the page rather than redrawing it, so module-level words a
 * remote worked out once are worked out again.
 *
 * On the server many people's pages render at once, in their own languages,
 * so a `t` there asks the render it is part of: `use(LanguageContext)`, which
 * React answers from the tree being rendered, never from whoever rendered
 * last.
 */

export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

function instanceOf(language: Language, messages: Messages): I18n {
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    fallbackLng: false,
    // Words in hand: nothing to wait for, so `t` answers on the first render.
    initAsync: false,
    resources: { [language]: messages },
    ns: Object.keys(messages),
    keySeparator: false,
    nsSeparator: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

/** Nothing in a message reads as nothing, as `{undefined}` does in JSX. */
const filled = (vars: TranslateVars | undefined): Record<string, string | number> =>
  Object.fromEntries(Object.entries(vars ?? {}).map(([k, v]) => [k, v ?? '']));

function lookup(i18n: I18n, ns: string, key: string, fallback: string, vars?: TranslateVars) {
  const text: unknown = i18n.getResource(i18n.language, ns, key);
  if (typeof text !== 'string' || text === '') return interpolate(fallback, vars);
  return i18n.t(key, { ns, defaultValue: fallback, replace: filled(vars) });
}

/* -------------------------------------------------------------- browser -- */

let page: I18n | null = null;

const browserSource: Translate = (ns, key, fallback, vars) =>
  page === null ? interpolate(fallback, vars) : lookup(page, ns, key, fallback, vars);

const stored = (language: Language, ns: string): string =>
  `kithena-i18n:${VERSION}:${language}:${ns}`;

/**
 * A namespace's words before its screens are evaluated: a remote works some
 * of its words out once, as it loads. From the copy this browser kept, at
 * once, or from the server, then kept for next time.
 */
export async function ensureNamespace(ns: Namespace): Promise<void> {
  if (page === null) return;
  const i18n = page;
  const language = i18n.language as Language;
  if (i18n.hasResourceBundle(language, ns)) return;
  try {
    const kept = localStorage.getItem(stored(language, ns));
    if (kept !== null) {
      i18n.addResourceBundle(language, ns, JSON.parse(kept) as Record<string, string>);
      return;
    }
  } catch {
    // No storage, or a damaged copy: load it.
  }
  const words = (await loadMessages(language, [ns]))[ns] ?? {};
  i18n.addResourceBundle(language, ns, words);
  try {
    // Older copies go: a new build may have changed any of them.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('kithena-i18n:') === true && !k.startsWith(`kithena-i18n:${VERSION}:`))
        localStorage.removeItem(k);
    }
    localStorage.setItem(stored(language, ns), JSON.stringify(words));
  } catch {
    // Full or blocked: next time it loads again.
  }
}

/* --------------------------------------------------------------- server -- */

const servers = new Map<Language, I18n>();

const serverSource: Translate = (ns, key, fallback, vars) => {
  let language: Language | null = null;
  try {
    language = use(LanguageContext);
  } catch {
    // Not inside a render: nobody's language to answer in.
  }
  const i18n = language === null ? undefined : servers.get(language);
  return i18n === undefined ? interpolate(fallback, vars) : lookup(i18n, ns, key, fallback, vars);
};

/* ------------------------------------------------------------- provider -- */

export function I18nProvider({
  language,
  messages,
  children,
}: {
  readonly language: Language;
  /** The shell's and Reach's words, which every page shows; a remote's load with it. */
  readonly messages: Messages;
  readonly children: ReactNode;
}): JSX.Element {
  const [i18n] = useState(() => {
    if (typeof window === 'undefined') {
      let held = servers.get(language);
      if (held === undefined) {
        held = instanceOf(language, messages);
        servers.set(language, held);
      } else
        for (const [ns, words] of Object.entries(messages))
          held.addResourceBundle(language, ns, words, true, true);
      setTranslate(serverSource);
      return held;
    }
    page = instanceOf(language, messages);
    setTranslate(browserSource);
    return page;
  });
  useEffect(() => {
    // The choice, kept where the browser can read it before it asks anybody.
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // Blocked: the cookie and the account still have it.
    }
    if (!document.cookie.includes(`${LANGUAGE_KEY}=${language}`))
      document.cookie = languageCookie(language);
  }, [language]);
  return (
    <LanguageContext value={language}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LanguageContext>
  );
}

/** The page's language, for a component that needs it (a date's format, a server render). */
export function useLanguage(): Language {
  return use(LanguageContext);
}

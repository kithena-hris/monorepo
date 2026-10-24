'use client';

import { englishOf, setTranslate, type Translate } from '@reach/ui/i18n';
import { setLocale } from '@reach/ui/intl';
import type { Language } from '@kithena/contracts/language';
import { createContext, use, useState, type JSX, type ReactNode } from 'react';

import { wordsIn, type PageWords } from '../lib/i18n';

/**
 * A client component's words. In the browser the page is one reader's, so
 * Reach's `t` answers from the words the layout sent; on the server many
 * readers render at once, so it answers from the tree being rendered.
 */

interface Held {
  readonly language: Language;
  readonly words: PageWords;
}

const Context = createContext<Held | null>(null);

const lookup: (held: Held | null) => Translate = (held) => (ns, key, fallback, vars) =>
  held === null
    ? englishOf(fallback, vars)
    : wordsIn(held.language, held.words[ns === 'reach' ? 'reach' : 'jobs'])(key, fallback, vars);

const fromTree = (): Held | null => {
  try {
    return use(Context);
  } catch {
    return null;
  }
};

let page: Held | null = null;

export function I18nProvider({
  language,
  words,
  children,
}: {
  readonly language: Language;
  readonly words: PageWords;
  readonly children: ReactNode;
}): JSX.Element {
  const [held] = useState<Held>(() => {
    const next = { language, words };
    if (typeof window === 'undefined') {
      setTranslate((...args) => lookup(fromTree())(...args));
      setLocale(() => fromTree()?.language ?? 'en-US');
    } else {
      page = next;
      setTranslate((...args) => lookup(page)(...args));
      setLocale(() => page?.language ?? 'en-US');
    }
    return next;
  });
  return <Context value={held}>{children}</Context>;
}

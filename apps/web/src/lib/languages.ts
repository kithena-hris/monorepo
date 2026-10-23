/**
 * The languages Kithena speaks, each named in itself, so somebody who reads
 * only Polish finds "Polski" in a list written in German.
 *
 * A plain module: the root layout reads the choice on the server and the
 * menu writes it in the browser. US English is the default; the words in the
 * code are the English every other language is translated from.
 */
export const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'ca', name: 'Català' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pt', name: 'Português' },
  { code: 'pl', name: 'Polski' },
  { code: 'ru', name: 'Русский' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en-US';

export const isLanguage = (value: unknown): value is Language =>
  LANGUAGES.some((l) => l.code === value);

/**
 * Where the choice is kept besides the person's account: a cookie, so the
 * server renders the first page in it, and `localStorage`, so the browser has
 * it before it asks. The account (identity's `language` preference) is what
 * follows the person to another device.
 */
export const LANGUAGE_KEY = 'kithena-language';

/** A year, like any preference; `Lax`, because it only shapes the page. */
export function languageCookie(language: Language): string {
  return `${LANGUAGE_KEY}=${language}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Whose words a key is: the shell's, Reach's own, and each remote's, by the
 * name it is federated under.
 */
export const NAMESPACES = [
  'shell',
  'reach',
  'people',
  'timeoff',
  'recruiting',
  'documents',
  'onboarding',
  'performance',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** A namespace's words in one language, by key. */
export type Messages = Readonly<Record<string, Readonly<Record<string, string>>>>;

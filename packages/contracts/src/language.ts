import * as z from 'zod';

/**
 * The languages Kithena speaks, each named in itself, so somebody who reads
 * only Polish finds "Polski" in a list written in German.
 *
 * One list for every place that names a language: the app's menu, the back
 * office's company setting, identity's check on it, and messaging, which
 * writes every email in the company's language whatever its reader chose for
 * their screens. US English is the default, and the English in the code is
 * what every other language is translated from.
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
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ta', name: 'தமிழ்' },
] as const;

export const LanguageCode = z.enum(LANGUAGES.map((l) => l.code) as [Language, ...Language[]]);
export type Language = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en-US';

export const isLanguage = (value: unknown): value is Language =>
  LANGUAGES.some((l) => l.code === value);

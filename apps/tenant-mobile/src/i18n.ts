import { DEFAULT_LANGUAGE, isLanguage, type Language } from '@kithena/contracts/language';
import {
  englishOf,
  interpolate,
  setLocale,
  setTranslate,
  translator,
  type Plural,
  type TranslateVars,
} from '@reach/ui-native';
import * as SecureStore from 'expo-secure-store';

import { CATALOGUES } from './locales';

/**
 * The phone's words in its reader's language, through Reach's port: the app's
 * screens ask `t` (namespace `mobile`), Reach Mobile's components their own
 * (`reach-native`), and both are answered here. A key with no words in the
 * language reads in English, so a screen is never a row of keys.
 *
 * The language is the one chosen on this phone (Me › Account › Language), else
 * the company's (the back office's setting), else US English. Changing it
 * redraws every screen (`useLanguage`).
 */
export const t = translator('mobile');

const KEY = 'kithena.language';

let current: Language = DEFAULT_LANGUAGE;
let chosen = false;
const listeners = new Set<() => void>();

function lookup(
  namespace: string,
  key: string,
  fallback: string | Plural,
  vars?: TranslateVars,
): string {
  const words = CATALOGUES[current][namespace] ?? {};
  if (typeof fallback === 'string') return interpolate(words[key] ?? fallback, vars);
  const form = new Intl.PluralRules(current).select(Number(vars?.['count'] ?? 0));
  const own = words[`${key}_${form}`] ?? words[`${key}_other`];
  return own === undefined ? englishOf(fallback, vars) : interpolate(own, vars);
}

function apply(language: Language): void {
  current = language;
  setLocale(() => current);
  setTranslate(lookup);
  for (const listener of listeners) listener();
}

/** The language screens are in now. */
export const language = (): Language => current;

/** What was chosen on this phone, put back before anything is drawn. */
export async function restoreLanguage(): Promise<void> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  chosen = isLanguage(saved);
  apply(isLanguage(saved) ? saved : DEFAULT_LANGUAGE);
}

/** The company's language, for a reader who has not chosen one. */
export function companyLanguage(code: unknown): void {
  if (!chosen && isLanguage(code) && code !== current) apply(code);
}

/** The reader's own choice, kept on this phone. */
export function chooseLanguage(next: Language): void {
  chosen = true;
  void SecureStore.setItemAsync(KEY, next).catch(() => undefined);
  if (next !== current) apply(next);
}

/** Subscribes a screen to a change of language; the root keys its tree on it. */
export function onLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every request says which language its words should come back in. */
export const languageHeader = (): Record<string, string> => ({ 'x-kithena-language': current });

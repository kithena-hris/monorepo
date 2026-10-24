import type { Language } from '@kithena/contracts/language';
import * as SecureStore from 'expo-secure-store';

import { chooseLanguage, restoreChoice } from './i18n';

/** Where this phone keeps its reader's language. */
const KEY = 'kithena.language';

/** The language chosen on this phone, put back before anything is drawn. */
export async function restoreLanguage(): Promise<void> {
  restoreChoice(await SecureStore.getItemAsync(KEY).catch(() => null));
}

/** The reader's choice: the screens at once, and this phone remembers it. */
export function saveLanguage(next: Language): void {
  chooseLanguage(next);
  void SecureStore.setItemAsync(KEY, next).catch(() => undefined);
}

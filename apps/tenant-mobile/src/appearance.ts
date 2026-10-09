import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';

/** Light or dark for this person on this phone, or whatever the phone is set to. */
export type Look = 'system' | 'light' | 'dark';

const KEY = 'kithena.appearance';

const apply = (look: Look): void => {
  Appearance.setColorScheme(look === 'system' ? 'unspecified' : look);
};

export async function savedLook(): Promise<Look> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

/** What was chosen last time, put back before anything is drawn. */
export async function restoreLook(): Promise<void> {
  apply(await savedLook());
}

export function setLook(look: Look): void {
  apply(look);
  void SecureStore.setItemAsync(KEY, look).catch(() => undefined);
}

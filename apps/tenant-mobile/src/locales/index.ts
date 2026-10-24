/**
 * Every language's words for the phone: the app's own (`mobile`) and Reach
 * Mobile's (`reach-native`), translated from the English in the code by
 * `apps/web/scripts/i18n-translate.mjs`. Bundled whole: a phone may be offline
 * when its reader changes language.
 */
import type { Language } from '@kithena/contracts/language';

import mobileenUS from './mobile/en-US.json';
import mobileenGB from './mobile/en-GB.json';
import mobilede from './mobile/de.json';
import mobilefr from './mobile/fr.json';
import mobilees from './mobile/es.json';
import mobileit from './mobile/it.json';
import mobileca from './mobile/ca.json';
import mobilenl from './mobile/nl.json';
import mobilept from './mobile/pt.json';
import mobilepl from './mobile/pl.json';
import mobileru from './mobile/ru.json';
import mobilehi from './mobile/hi.json';
import mobileta from './mobile/ta.json';
import nativeenUS from './reach-native/en-US.json';
import nativeenGB from './reach-native/en-GB.json';
import nativede from './reach-native/de.json';
import nativefr from './reach-native/fr.json';
import nativees from './reach-native/es.json';
import nativeit from './reach-native/it.json';
import nativeca from './reach-native/ca.json';
import nativenl from './reach-native/nl.json';
import nativept from './reach-native/pt.json';
import nativepl from './reach-native/pl.json';
import nativeru from './reach-native/ru.json';
import nativehi from './reach-native/hi.json';
import nativeta from './reach-native/ta.json';

type Catalogue = Readonly<Record<string, string>>;

/** A language's words by namespace. */
export const CATALOGUES: Readonly<Record<Language, Readonly<Record<string, Catalogue>>>> = {
  'en-US': { mobile: mobileenUS, 'reach-native': nativeenUS },
  'en-GB': { mobile: mobileenGB, 'reach-native': nativeenGB },
  de: { mobile: mobilede, 'reach-native': nativede },
  fr: { mobile: mobilefr, 'reach-native': nativefr },
  es: { mobile: mobilees, 'reach-native': nativees },
  it: { mobile: mobileit, 'reach-native': nativeit },
  ca: { mobile: mobileca, 'reach-native': nativeca },
  nl: { mobile: mobilenl, 'reach-native': nativenl },
  pt: { mobile: mobilept, 'reach-native': nativept },
  pl: { mobile: mobilepl, 'reach-native': nativepl },
  ru: { mobile: mobileru, 'reach-native': nativeru },
  hi: { mobile: mobilehi, 'reach-native': nativehi },
  ta: { mobile: mobileta, 'reach-native': nativeta },
};

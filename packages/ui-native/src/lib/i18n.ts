/**
 * Reach Mobile's own words, through the same port as Reach's (`@reach/ui/i18n`):
 * the app hands it the function that looks a key up (`setTranslate`), and a
 * key it does not know reads in English. The namespace is `reach-native`, so
 * the phone's components are translated where they sit, not as the web's.
 */
import { translator } from '@reach/ui/i18n';

export const t = translator('reach-native');

import { SIGNATURE_FONTS } from '@reach/ui-native';
import { loadAsync } from 'expo-font';

import bold from '../assets/fonts/MrDafoe-Regular.ttf';
import flowing from '../assets/fonts/GreatVibes-Regular.ttf';
import light from '../assets/fonts/Sacramento-Regular.ttf';

/**
 * The handwriting faces Reach's `Signature` names (`SIGNATURE_FONTS`): Great
 * Vibes, Sacramento and Mr Dafoe (OFL, `assets/fonts`), the web's and the
 * signed PDF's. Loaded when a signature is first shown, once.
 */
export const SIGNATURE_FACES = {
  [SIGNATURE_FONTS.flowing]: flowing,
  [SIGNATURE_FONTS.light]: light,
  [SIGNATURE_FONTS.bold]: bold,
};

let faces: Promise<void> | undefined;
export const signatureFaces = (): Promise<void> => (faces ??= loadAsync(SIGNATURE_FACES));

/**
 * Words and formats in the reader's language, with nothing of React Native in
 * them: what a phone app's plain modules (a model, a sentence, a date) import,
 * so they stay testable without a device. The same port as Reach's on the web.
 */
export {
  englishOf,
  interpolate,
  setTranslate,
  translator,
  type Plural,
  type T,
  type Translate,
  type TranslateVars,
} from '@reach/ui/i18n';
export {
  dateFormat,
  formatList,
  formatNumber,
  formatRelative,
  inSentence,
  languageName,
  locale,
  numberFormat,
  regionName,
  setLocale,
} from '@reach/ui/intl';

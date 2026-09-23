/**
 * Whether a piece of free text carries a given value, however it was typed.
 *
 * Both sides are folded the same way first: Unicode compatibility forms
 * (NFKC, so a full-width `ＡＢ１２` is `AB12`), then diacritics and invisible
 * format characters dropped (so `José` is `jose` and a zero-width space does
 * not split a word), then lower case. Everything that is not a letter or a
 * digit is a separator.
 *
 * Three kinds of value, because one rule cannot serve all three.
 *
 * **Text.** Matches when some run of whole words in the text, glued together,
 * spells it. That covers the identifier shapes — `DE89 3704 0044 0532 0130
 * 00`, `123-45-6789`, `AB 12 34 56 C`, `12345678-Z`, `ABCDE1234F` all match
 * their stored form — and a multi-word value typed with different spacing or
 * punctuation. Whole words rather than any substring, because a religion
 * stored as `Christian` must not refuse every prompt about Christiansen. A
 * value with a digit and at least `IDENTIFIER_MIN` characters also matches
 * anywhere inside the text: `ssn123456789` is one word, and an identifier that
 * long does not occur by accident.
 *
 * **Short.** Under `SHORT_BELOW` characters with no digit — blood group `A`,
 * `AB`, a sex marker `F` — the value is an ordinary word, and refusing every
 * prompt containing "a" would make the gateway useless without making anyone
 * safer. It matches only as a whole word within `NAME_WINDOW` words of one of
 * its own attribute's names (key or label, any locale): `blood group: A`,
 * `grupo sanguíneo AB`. Anywhere else it is ignored.
 *
 * **Date.** A stored calendar date (`1990-01-02`) matches in the forms people
 * write one: ISO, day/month/year and month/day/year with any separator, two-
 * or four-digit years, with or without leading zeros or ordinal suffixes, and
 * with the month spelled out in any language a country pack is written for
 * (`2 January 1990`, `Jan 2, 1990`, `2 de enero de 1990`, `2. Januar 1990`).
 * A numeric form is read both ways round, so `01/02/1990` matches the 1st of
 * February and the 2nd of January: which one the writer meant is not
 * something the gateway can know, and refusing both is the safe side.
 */

const IDENTIFIER_MIN = 6;
/** A value shorter than this, with no digit, is a short value. */
export const SHORT_BELOW = 4;
/** How many words away from its attribute's name a short value may sit. */
export const NAME_WINDOW = 3;

/**
 * Month names, folded, by month number. English, Spanish, Catalan, German
 * and Hindi: the languages of the country packs (ES, GB, DE, IN, US).
 */
const MONTHS: readonly (readonly string[])[] = [
  ['january', 'jan', 'enero', 'ene', 'gener', 'januar', 'jänner', 'जनवरी'],
  ['february', 'feb', 'febrero', 'febrer', 'februar', 'फ़रवरी', 'फरवरी'],
  ['march', 'mar', 'marzo', 'marc', 'març', 'märz', 'maerz', 'mär', 'मार्च'],
  ['april', 'apr', 'abril', 'abr', 'अप्रैल'],
  ['may', 'mayo', 'maig', 'mai', 'मई'],
  ['june', 'jun', 'junio', 'juny', 'juni', 'जून'],
  ['july', 'jul', 'julio', 'juliol', 'juli', 'जुलाई'],
  ['august', 'aug', 'agosto', 'ago', 'agost', 'अगस्त'],
  ['september', 'sep', 'sept', 'septiembre', 'setiembre', 'set', 'setembre', 'सितंबर', 'सितम्बर'],
  ['october', 'oct', 'octubre', 'oktober', 'okt', 'अक्टूबर'],
  ['november', 'nov', 'noviembre', 'novembre', 'नवंबर', 'नवम्बर'],
  ['december', 'dec', 'diciembre', 'dic', 'desembre', 'des', 'dezember', 'dez', 'दिसंबर', 'दिसम्बर'],
];

/** Words a written date carries that are not part of it: `2 de enero de 1990`, `the 2nd of January`. */
const DATE_FILLER: ReadonlySet<string> = new Set(['de', 'del', 'of', 'the', 'el', 'der', 'den']);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ORDINAL = /^(\d{1,2})(?:st|nd|rd|th|o|a|er|e)$/;

/** Case, compatibility forms, accents and invisible characters folded away. */
function fold(text: string): string {
  return text
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase();
}

function words(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** A word as a date part: `02` and `2nd` are `2`. */
function datePart(word: string): string {
  const ordinal = ORDINAL.exec(word);
  const digits = ordinal?.[1] ?? word;
  return /^\d+$/.test(digits) ? String(Number(digits)) : word;
}

const glue = (value: string): string => words(value).join('');

interface TextNeedle {
  readonly kind: 'text';
  readonly glued: string;
  readonly identifier: boolean;
}
interface ShortNeedle {
  readonly kind: 'short';
  readonly word: string;
  readonly names: readonly TextNeedle[];
}
interface DateNeedle {
  readonly kind: 'date';
  /** Each a sequence of date parts, compared against the text's date words. */
  readonly forms: readonly (readonly string[])[];
}
export type Needle = TextNeedle | ShortNeedle | DateNeedle;

/** A name — a key or a label — to look for. Undefined when it has no letters or digits. */
export function nameNeedle(name: string): TextNeedle | undefined {
  const glued = glue(name);
  if (glued.length === 0) return undefined;
  return { kind: 'text', glued, identifier: glued.length >= IDENTIFIER_MIN && /\p{N}/u.test(glued) };
}

function dateNeedle(year: string, month: string, day: string): DateNeedle {
  const d = String(Number(day));
  const m = String(Number(month));
  const years = [String(Number(year)), String(Number(year.slice(2)))];
  const forms: string[][] = [
    // Written without separators: 19900102, 02011990, 01021990.
    [year + month + day],
    [day + month + year],
    [month + day + year],
  ];
  for (const y of years) {
    forms.push([y, m, d], [d, m, y], [m, d, y]);
    for (const name of MONTHS[Number(month) - 1] ?? []) {
      const n = words(name).join('');
      forms.push([d, n, y], [n, d, y]);
    }
  }
  // Read the way the text is read, so `02011990` is compared as the text sees it.
  return { kind: 'date', forms: forms.map((form) => form.map(datePart)) };
}

/**
 * A stored value to look for. `names` are its attribute's key and labels,
 * which a short value needs and anything else ignores. Undefined when there
 * is nothing that could match.
 */
export function valueNeedle(value: string, names: readonly string[] = []): Needle | undefined {
  const iso = ISO_DATE.exec(value.trim());
  if (iso) return dateNeedle(iso[1] ?? '', iso[2] ?? '', iso[3] ?? '');

  const text = nameNeedle(value);
  if (!text) return undefined;
  if (text.glued.length >= SHORT_BELOW || /\p{N}/u.test(text.glued)) return text;

  const nameNeedles = names.map(nameNeedle).filter((n): n is TextNeedle => n !== undefined);
  return nameNeedles.length === 0 ? undefined : { kind: 'short', word: text.glued, names: nameNeedles };
}

/** Text to search, folded once however many needles are looked for in it. */
export interface Haystack {
  readonly words: readonly string[];
  readonly glued: string;
  /** Words as date parts, filler dropped. */
  readonly dateWords: readonly string[];
}

export function haystack(texts: readonly string[]): Haystack {
  const all = texts.flatMap(words);
  return {
    words: all,
    glued: all.join(''),
    dateWords: all.filter((w) => !DATE_FILLER.has(w)).map(datePart),
  };
}

/** Every `[first, last]` word index of a run of whole words spelling `glued`. */
function runs(text: Haystack, glued: string): [number, number][] {
  const found: [number, number][] = [];
  for (let start = 0; start < text.words.length; start += 1) {
    let at = 0;
    for (let i = start; i < text.words.length; i += 1) {
      const word = text.words[i] ?? '';
      if (!glued.startsWith(word, at)) break;
      at += word.length;
      if (at === glued.length) {
        found.push([start, i]);
        break;
      }
    }
  }
  return found;
}

function hasSequence(haystackWords: readonly string[], form: readonly string[]): boolean {
  for (let start = 0; start + form.length <= haystackWords.length; start += 1) {
    if (form.every((part, i) => haystackWords[start + i] === part)) return true;
  }
  return false;
}

export function contains(text: Haystack, value: Needle): boolean {
  switch (value.kind) {
    case 'text':
      return (value.identifier && text.glued.includes(value.glued)) || runs(text, value.glued).length > 0;
    case 'date':
      return value.forms.some((form) => hasSequence(text.dateWords, form));
    case 'short': {
      const names = value.names.flatMap((name) => runs(text, name.glued));
      return text.words.some(
        (word, i) =>
          word === value.word &&
          names.some(([first, last]) => (i > last ? i - last : first - i) <= NAME_WINDOW && (i < first || i > last)),
      );
    }
  }
}

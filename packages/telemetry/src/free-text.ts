/**
 * Whether a piece of free text carries a given value, however it was typed.
 *
 * Both sides are folded the same way first: Unicode compatibility forms
 * (NFKC, so a full-width `ＡＢ１２` is `AB12`), then diacritics and invisible
 * format characters dropped (so `José` is `jose` and a zero-width space does
 * not split a word), then lower case. Everything that is not a letter or a
 * digit is a separator.
 *
 * A value matches when some **run of whole words** in the text, glued
 * together, spells it. That one rule covers what the identifier shapes need —
 * `DE89 3704 0044 0532 0130 00`, `123-45-6789`, `AB 12 34 56 C`,
 * `12345678-Z` and `ABCDE1234F` all match their stored form — and a
 * multi-word value typed with different spacing or punctuation. Whole words
 * rather than any substring, because a religion stored as `Christian` must
 * not refuse every prompt that mentions an employee called Christiansen.
 *
 * A value with a digit in it and at least `IDENTIFIER_MIN` characters also
 * matches anywhere inside the text, glued or not: `ssn123456789` is one word,
 * and an identifier that long is not going to occur by accident.
 */

const IDENTIFIER_MIN = 6;

/** Case, compatibility forms, accents and invisible characters folded away. */
function fold(text: string): string {
  return text
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase();
}

function words(text: string): readonly string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Something to look for, folded once. Undefined for a value with no letters or digits. */
export interface Needle {
  readonly glued: string;
  readonly identifier: boolean;
}

export function needle(value: string): Needle | undefined {
  const glued = words(value).join('');
  if (glued.length === 0) return undefined;
  return { glued, identifier: glued.length >= IDENTIFIER_MIN && /\p{N}/u.test(glued) };
}

/** Text to search, folded once however many needles are looked for in it. */
export interface Haystack {
  readonly words: readonly string[];
  readonly glued: string;
}

export function haystack(texts: readonly string[]): Haystack {
  const all = texts.flatMap(words);
  return { words: all, glued: all.join('') };
}

export function contains(text: Haystack, value: Needle): boolean {
  if (value.identifier && text.glued.includes(value.glued)) return true;

  for (let start = 0; start < text.words.length; start += 1) {
    let at = 0;
    for (let i = start; i < text.words.length; i += 1) {
      const word = text.words[i] ?? '';
      if (!value.glued.startsWith(word, at)) break;
      at += word.length;
      if (at === value.glued.length) return true;
    }
  }
  return false;
}

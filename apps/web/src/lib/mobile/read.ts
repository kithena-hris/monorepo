/**
 * What the phone sends to be read rather than typed (Kithena Mobile v3 P15,
 * P19): the text in a photo of an ID card, and the facts in an offer letter.
 * Pure, so the rules are tested without OCR or a PDF; the routes under
 * `app/api/mobile` run the reading and keep nothing.
 */

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Characters OCR confuses in a run of digits: an O for a 0, an I for a 1. */
const DIGITS: Readonly<Record<string, string>> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
};

/** The letters OCR reads as a digit, at the control letter's place. */
const LOOKS_LIKE: Readonly<Record<string, readonly string[]>> = {
  '0': ['O', 'D', 'Q'],
  '1': ['I', 'L', 'T'],
  '2': ['Z'],
  '5': ['S'],
  '6': ['G'],
  '7': ['T'],
  '8': ['B'],
};

/** Whether a NIF or NIE carries the control letter its digits call for. */
function valid(v: string): boolean {
  let digits: string;
  if (/^\d{8}[A-Z]$/u.test(v)) digits = v.slice(0, 8);
  else if (/^[XYZ]\d{7}[A-Z]$/u.test(v))
    digits = String('XYZ'.indexOf(v.charAt(0))) + v.slice(1, 8);
  else return false;
  return DNI_LETTERS.charAt(Number(digits) % 23) === v.charAt(v.length - 1);
}

/**
 * The first Spanish NIF or NIE in OCR'd text whose control letter checks out,
 * the card's front or its machine-readable lines: nothing else is returned,
 * so a photo yields one identifier or nothing.
 */
export function nifIn(text: string): string | null {
  // Spaces, dots and dashes dropped, as a printed number is often split; every
  // nine-character window then tried, so a neighbouring word cannot hide it.
  const flat = text
    .toUpperCase()
    .slice(0, 4000)
    .replace(/[\s.-]/gu, '');
  const digits = (run: string): string =>
    run
      .split('')
      .map((c) => DIGITS[c] ?? c)
      .join('');
  for (let i = 0; i + 9 <= flat.length; i += 1) {
    const w = flat.slice(i, i + 9);
    const last = w.charAt(8);
    // Mostly real digits: a word whose letters look like digits is not a number.
    if ((w.slice(0, 8).match(/\d/gu) ?? []).length < 6) continue;
    // The control letter, or a digit OCR made of one: a Z read as a 2.
    const letters = /[A-Z]/u.test(last) ? [last] : (LOOKS_LIKE[last] ?? []);
    const head = w.charAt(0);
    const candidates = letters.flatMap((letter) => [
      `${digits(w.slice(0, 8))}${letter}`,
      ...('XYZ'.includes(head) ? [`${head}${digits(w.slice(1, 8))}${letter}`] : []),
    ]);
    const found = candidates.find(valid);
    if (found !== undefined) return found;
  }
  return null;
}

export interface OfferFacts {
  readonly given: string | null;
  readonly family: string | null;
  readonly email: string | null;
  /** YYYY-MM-DD. */
  readonly start: string | null;
  /** The name the letter says they report to, matched to a person by the phone. */
  readonly manager: string | null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const iso = (y: number, m: number, d: number): string | null =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null;

/** A date written out near a phrase about starting: "start on 16 November 2026", "1/11/2026". */
function startIn(text: string): string | null {
  const near =
    /(start(?:ing)?|commence|first day|joining|fecha de (?:alta|incorporaci[oó]n)|incorpor\w+)[^.\n]{0,80}/iu.exec(
      text,
    )?.[0] ?? '';
  const words =
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+|de\s+)?([a-zA-Zé]+)\s+(?:de\s+)?(\d{4})/u.exec(near);
  if (words !== null) {
    const month = words[2]?.toLowerCase() ?? '';
    const m = MONTHS.indexOf(month) + 1 || MESES.indexOf(month) + 1;
    if (m > 0) return iso(Number(words[3]), m, Number(words[1]));
  }
  const us = /([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/u.exec(near);
  if (us !== null) {
    const m = MONTHS.indexOf(us[1]?.toLowerCase() ?? '') + 1;
    if (m > 0) return iso(Number(us[3]), m, Number(us[2]));
  }
  const numeric = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/u.exec(near);
  if (numeric !== null) return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const isoDate = /(\d{4})-(\d{2})-(\d{2})/u.exec(near);
  return isoDate === null ? null : iso(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
}

/**
 * What an offer letter says about the new starter: their name from the
 * greeting, a work email if one is written, when they start, and whom they
 * report to. A fact the letter does not state plainly is left empty for HR.
 */
export function offerFacts(raw: string): OfferFacts {
  const text = raw.replace(/\r/gu, '').slice(0, 20_000);
  const greeting =
    /(?:Dear|Estimad[oa]|Hola|Hi|Hello)\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+){0,3})/u.exec(
      text,
    );
  const parts = greeting?.[1]?.trim().split(/\s+/u) ?? [];
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u.exec(text)?.[0] ?? null;
  const manager =
    /(?:report(?:ing)? (?:directly )?to|line manager(?: will be)?|manager(?: will be)?:?|reportar[aá]s? a)\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+){0,2})/u.exec(
      text,
    )?.[1] ?? null;
  return {
    given: parts.length >= 2 ? (parts[0] ?? null) : null,
    family: parts.length >= 2 ? parts.slice(1).join(' ') : null,
    email,
    start: startIn(text),
    manager,
  };
}

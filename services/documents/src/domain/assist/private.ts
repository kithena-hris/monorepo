/**
 * What a model is shown of a private value (PRD §14.1): a stand-in. Before
 * anything leaves Documents for a model, every name of the company's people,
 * every email, phone or identity number, bank account and document number
 * becomes `[[Person 1]]`, `[[Email 1]]` and so on; the answer comes back with
 * the stand-ins, and only then, in this process, are the values put back.
 * The provider is shown a document about nobody in particular, and the map
 * from stand-in to value lives for one request and is never stored.
 *
 * Amounts, dates and the words around them stay: a summary of a contract
 * without its salary or its start date is no summary, and neither says whose
 * contract it is once the names are gone.
 *
 * A name is the company's people's, or one `findNames` recognises in the
 * text: somebody outside, a witness, a candidate, found on this server.
 * Street addresses go too.
 *
 * ponytail: a name finder misses an unusual name, and a postcode stays (it
 * cannot be told from an amount); a stand-in for every capitalised word is
 * the upgrade, at the cost of the model reading less.
 */

type Kind = 'Person' | 'Email' | 'Number' | 'Account' | 'ID' | 'Address';

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/gu;
/** A document or passport number: letters and digits run together, six or more. */
const CODE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b/gu;
/** A phone or identity number: nine digits or more, spaced, dashed or bracketed; never an amount or a date. */
const NUMBER = /(?<![\w/]|\d[.,])\+?\(?\d[\d ()-]{7,}\d(?![\w/]|[.,]\d)/gu;
/** A street address: a number, a few words, and the kind of street; or the street first, as in Spain. */
const ADDRESS =
  /\b\d{1,5}\s+(?:[A-Z0-9][\w'.-]*\s+){0,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Plaza|Sq|Square|Terrace|Hwy|Highway)\b\.?|\b(?:Calle|Carrer|Avenida|Plaza|Rua|Via|Rue|Straße|Strasse)\s+(?:[\p{Lu}][\p{L}'-]*\s*){1,4},?\s*\d{1,4}\b/gu;
const STAND_IN = /\[\[(Person|Email|Number|Account|ID|Address) (\d+)\]\]/gu;

/** Words that are a name and something else, which a model needs to read as the other. */
const COMMON = new Set([
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
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const escape = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export interface Pseudonyms {
  /** Every string in a JSON value, with each private value replaced by its stand-in. */
  mask(value: unknown): unknown;
  /** Every stand-in this made, in every string of a JSON value, back to its value. */
  unmask(value: unknown): unknown;
}

/** Whole names, longest first, then each of their words that is not also a month or a day. */
function namePatterns(names: readonly string[]): readonly RegExp[] {
  const full = [...new Set(names.map((n) => n.trim()).filter((n) => n.includes(' ')))].toSorted(
    (a, b) => b.length - a.length,
  );
  const words = [...new Set(names.flatMap((n) => n.trim().split(/\s+/u)))].filter(
    (w) => w.length >= 3 && !COMMON.has(w.toLowerCase()),
  );
  return [
    ...(full.length === 0 ? [] : [new RegExp(`\\b(?:${full.map(escape).join('|')})\\b`, 'giu')]),
    ...(words.length === 0 ? [] : [new RegExp(`\\b(?:${words.map(escape).join('|')})\\b`, 'gu')]),
  ];
}

export function pseudonymise(
  names: readonly string[],
  /** Names in a text the company does not know: found on this server, never by a model. */
  findNames: (text: string) => readonly string[] = () => [],
): Pseudonyms {
  const known = namePatterns(names);

  const byValue = new Map<string, string>();
  const byStandIn = new Map<string, string>();
  const counts = new Map<Kind, number>();
  const standIn = (kind: Kind) => (value: string) => {
    const known = byValue.get(value);
    if (known !== undefined) return known;
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    const made = `[[${kind} ${String(n)}]]`;
    byValue.set(value, made);
    byStandIn.set(made, value);
    return made;
  };
  const digits = (s: string) => s.replaceAll(/\D/gu, '').length;

  const maskText = (text: string): string => {
    let out = text
      .replaceAll(EMAIL, standIn('Email'))
      .replaceAll(IBAN, standIn('Account'))
      .replaceAll(CODE, standIn('ID'))
      .replaceAll(NUMBER, (m) => (digits(m) >= 9 ? standIn('Number')(m) : m))
      .replaceAll(ADDRESS, standIn('Address'));
    const found = findNames(out).filter((n) => !n.includes('[['));
    for (const pattern of [...namePatterns(found), ...known]) {
      out = out.replaceAll(pattern, standIn('Person'));
    }
    return out;
  };
  const unmaskText = (text: string): string =>
    text.replaceAll(STAND_IN, (m) => byStandIn.get(m) ?? m);

  const walk = (value: unknown, on: (s: string) => string): unknown => {
    if (typeof value === 'string') return on(value);
    if (Array.isArray(value)) return value.map((v) => walk(v, on));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, on)]));
    }
    return value;
  };

  return {
    mask: (value) => walk(value, maskText),
    unmask: (value) => walk(value, unmaskText),
  };
}

/** Told to the model with every request that carries stand-ins. */
export const STAND_INS =
  'Text in double square brackets, such as [[Person 1]] or [[Email 2]], stands for a private value. ' +
  'Copy it exactly, brackets included, wherever it belongs; never guess or change what it stands for.';

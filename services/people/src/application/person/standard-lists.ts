/**
 * The standard lists a field can take a value from: countries, currencies,
 * languages and time zones. One place for both halves — what a form offers
 * to pick and what a write accepts — so a choice offered is a choice saved.
 *
 * Read from the runtime's own ICU data rather than copied into a constant:
 * the lists change (a zone is added, a currency retired), and a copy is a copy
 * that refuses a real employee's real answer. They are built once per
 * process, here, on the server, and sent with the field, so every browser
 * draws the server's list and the first render hydrates unchanged.
 */

export interface Choice {
  readonly value: string;
  readonly label: string;
}

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCodePoint(65 + i));
const pairsOf = (): string[] => LETTERS.flatMap((a) => LETTERS.map((b) => a + b));

/**
 * Region codes CLDR names that are not ISO 3166-1 countries: groupings,
 * reserved codes and its test regions. Kosovo (`XK`) stays: people are from it.
 */
const NOT_COUNTRIES = new Set([
  'AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'EZ', 'IC', 'QO', 'TA', 'UN', 'XA', 'XB', 'ZZ',
]);

const byLabel = (a: Choice, b: Choice): number => a.label.localeCompare(b.label, 'en');

let lists: {
  readonly country: readonly Choice[];
  readonly currency: readonly Choice[];
  readonly language: readonly Choice[];
  readonly time_zone: readonly Choice[];
} | null = null;

function build(): NonNullable<typeof lists> {
  const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const languages = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  const currencies = new Intl.DisplayNames(['en'], { type: 'currency', fallback: 'none' });
  const named = (codes: readonly string[], name: (code: string) => string | undefined) =>
    codes.flatMap((value) => {
      const label = name(value);
      return label === undefined ? [] : [{ value, label }];
    });
  return {
    // ISO 3166-1 alpha-2: every two-letter code CLDR has a country's name for.
    country: named(
      pairsOf().filter((c) => !NOT_COUNTRIES.has(c)),
      (c) => regions.of(c),
    ).toSorted(byLabel),
    // ISO 4217, as the runtime knows them, with the code beside the name.
    currency: named(Intl.supportedValuesOf('currency'), (c) => {
      const name = currencies.of(c);
      return name === undefined ? undefined : `${name} (${c})`;
    }).toSorted(byLabel),
    // ISO 639-1: every two-letter code CLDR names a language for.
    language: named(
      pairsOf().map((c) => c.toLowerCase()),
      (c) => languages.of(c),
    ).toSorted(byLabel),
    // IANA, canonical names; an alias a device reports is still accepted.
    time_zone: Intl.supportedValuesOf('timeZone').map((value) => ({ value, label: value })),
  };
}

/** A standard list, by the data type that takes its values; null for any other type. */
export function standardList(dataType: string): readonly Choice[] | null {
  lists ??= build();
  switch (dataType) {
    case 'country':
    case 'currency':
    case 'language':
    case 'time_zone':
      return lists[dataType];
    default:
      return null;
  }
}

/** Whether a code is an ISO 3166-1 country this system offers. */
export function isCountry(code: string): boolean {
  countries ??= new Set((standardList('country') ?? []).map((c) => c.value));
  return countries.has(code);
}
let countries: ReadonlySet<string> | null = null;

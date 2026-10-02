/**
 * Where a work location is, read from what a file says of it: its time zone,
 * its address, or a city in its name ("Chicago HQ"). Lookups, never a model:
 * a workplace's name and address are configuration, and nothing here reads a
 * person's own address. Only the countries People supports (`countryRules`).
 *
 * ponytail: well-known cities and zones only; a place that names none of them
 * gets the legal entity's country and zone and a note asking HR to check.
 */

/** Each zone's country, and each country's usual zone first. */
const ZONES: Readonly<Record<string, readonly string[]>> = {
  US: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'America/Detroit',
    'Pacific/Honolulu',
  ],
  CA: [
    'America/Toronto',
    'America/Vancouver',
    'America/Edmonton',
    'America/Winnipeg',
    'America/Halifax',
    'America/Regina',
    'America/St_Johns',
  ],
  GB: ['Europe/London'],
  IE: ['Europe/Dublin'],
  DE: ['Europe/Berlin'],
  ES: ['Europe/Madrid', 'Atlantic/Canary'],
  FR: ['Europe/Paris'],
  IT: ['Europe/Rome'],
  PT: ['Europe/Lisbon', 'Atlantic/Azores'],
  NL: ['Europe/Amsterdam'],
  IN: ['Asia/Kolkata', 'Asia/Calcutta'],
  AU: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth'],
};

const COUNTRY_OF_ZONE = new Map(
  Object.entries(ZONES).flatMap(([country, zones]) => zones.map((z) => [z, country] as const)),
);

export const countryOfZone = (zone: string): string | null => COUNTRY_OF_ZONE.get(zone) ?? null;

/** A country's usual zone: the one an office there most likely keeps. */
export const zoneOfCountry = (country: string): string | null => ZONES[country]?.[0] ?? null;

type Where = readonly [country: string, zone: string];
const US_E: Where = ['US', 'America/New_York'];
const US_C: Where = ['US', 'America/Chicago'];
const US_M: Where = ['US', 'America/Denver'];
const US_P: Where = ['US', 'America/Los_Angeles'];

const CITIES: Readonly<Record<string, Where>> = {
  'new york': US_E,
  atlanta: US_E,
  boston: US_E,
  miami: US_E,
  philadelphia: US_E,
  washington: US_E,
  charlotte: US_E,
  chicago: US_C,
  dallas: US_C,
  houston: US_C,
  austin: US_C,
  'san antonio': US_C,
  minneapolis: US_C,
  denver: US_M,
  phoenix: ['US', 'America/Phoenix'],
  'los angeles': US_P,
  'san francisco': US_P,
  seattle: US_P,
  portland: US_P,
  toronto: ['CA', 'America/Toronto'],
  montreal: ['CA', 'America/Toronto'],
  montréal: ['CA', 'America/Toronto'],
  ottawa: ['CA', 'America/Toronto'],
  vancouver: ['CA', 'America/Vancouver'],
  calgary: ['CA', 'America/Edmonton'],
  london: ['GB', 'Europe/London'],
  manchester: ['GB', 'Europe/London'],
  birmingham: ['GB', 'Europe/London'],
  edinburgh: ['GB', 'Europe/London'],
  glasgow: ['GB', 'Europe/London'],
  dublin: ['IE', 'Europe/Dublin'],
  berlin: ['DE', 'Europe/Berlin'],
  hamburg: ['DE', 'Europe/Berlin'],
  munich: ['DE', 'Europe/Berlin'],
  münchen: ['DE', 'Europe/Berlin'],
  frankfurt: ['DE', 'Europe/Berlin'],
  cologne: ['DE', 'Europe/Berlin'],
  köln: ['DE', 'Europe/Berlin'],
  madrid: ['ES', 'Europe/Madrid'],
  barcelona: ['ES', 'Europe/Madrid'],
  valencia: ['ES', 'Europe/Madrid'],
  seville: ['ES', 'Europe/Madrid'],
  sevilla: ['ES', 'Europe/Madrid'],
  paris: ['FR', 'Europe/Paris'],
  lyon: ['FR', 'Europe/Paris'],
  milan: ['IT', 'Europe/Rome'],
  rome: ['IT', 'Europe/Rome'],
  lisbon: ['PT', 'Europe/Lisbon'],
  amsterdam: ['NL', 'Europe/Amsterdam'],
  rotterdam: ['NL', 'Europe/Amsterdam'],
  bengaluru: ['IN', 'Asia/Kolkata'],
  bangalore: ['IN', 'Asia/Kolkata'],
  mumbai: ['IN', 'Asia/Kolkata'],
  delhi: ['IN', 'Asia/Kolkata'],
  hyderabad: ['IN', 'Asia/Kolkata'],
  chennai: ['IN', 'Asia/Kolkata'],
  pune: ['IN', 'Asia/Kolkata'],
  sydney: ['AU', 'Australia/Sydney'],
  melbourne: ['AU', 'Australia/Melbourne'],
};

/** A US state's or a Canadian province's zone, as an address writes it before its postcode. */
const REGIONS: Readonly<Record<string, Where>> = {
  ...Object.fromEntries(
    ['NY', 'NJ', 'GA', 'FL', 'MA', 'PA', 'NC', 'VA', 'MD', 'OH', 'MI', 'DC', 'CT', 'SC'].map(
      (s) => [s, US_E],
    ),
  ),
  ...Object.fromEntries(
    ['IL', 'TX', 'MN', 'MO', 'WI', 'TN', 'AL', 'LA', 'IA', 'OK', 'KS'].map((s) => [s, US_C]),
  ),
  ...Object.fromEntries(['CO', 'UT', 'NM'].map((s) => [s, US_M])),
  AZ: ['US', 'America/Phoenix'],
  ...Object.fromEntries(['CA', 'WA', 'OR', 'NV'].map((s) => [s, US_P])),
};
const PROVINCES: Readonly<Record<string, Where>> = {
  ON: ['CA', 'America/Toronto'],
  QC: ['CA', 'America/Toronto'],
  BC: ['CA', 'America/Vancouver'],
  AB: ['CA', 'America/Edmonton'],
};

const COUNTRY_NAMES: readonly (readonly [RegExp, string])[] = [
  [/\b(united states|usa|u\.s\.a\.?)\b/u, 'US'],
  [/\bcanada\b/u, 'CA'],
  [/\b(united kingdom|uk|england|scotland|wales)\b/u, 'GB'],
  [/\bireland\b/u, 'IE'],
  [/\b(germany|deutschland)\b/u, 'DE'],
  [/\b(spain|españa)\b/u, 'ES'],
  [/\b(france)\b/u, 'FR'],
  [/\b(italy|italia)\b/u, 'IT'],
  [/\bportugal\b/u, 'PT'],
  [/\b(netherlands|nederland)\b/u, 'NL'],
  [/\b(india|bharat)\b/u, 'IN'],
  [/\baustralia\b/u, 'AU'],
];

export interface PlaceHint {
  readonly country: string | null;
  readonly timeZone: string | null;
  /** The city it was read from, to say so: "Chicago". */
  readonly city: string | null;
}

const NOTHING: PlaceHint = { country: null, timeZone: null, city: null };

/**
 * Where a name or an address says a place is: a city it names, else a
 * state or province before a postcode ("IL 60606", "ON M5X 1A9"), else a
 * country it names. Nothing found, nothing guessed.
 */
export function placeIn(text: string): PlaceHint {
  const lower = text.normalize('NFKC').toLocaleLowerCase('en');
  const words = ` ${lower.replaceAll(/[^\p{L}\p{N}]+/gu, ' ')} `;
  for (const [city, [country, timeZone]] of Object.entries(CITIES)) {
    if (words.includes(` ${city} `)) {
      return { country, timeZone, city: city.replaceAll(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) };
    }
  }
  const us = /\b([A-Z]{2}) \d{5}(?:-\d{4})?\b/u.exec(text)?.[1];
  const usAt = us === undefined ? undefined : REGIONS[us];
  if (usAt) return { country: usAt[0], timeZone: usAt[1], city: null };
  const ca = /\b([A-Z]{2}) [A-Z]\d[A-Z] ?\d[A-Z]\d\b/u.exec(text)?.[1];
  const caAt = ca === undefined ? undefined : PROVINCES[ca];
  if (caAt) return { country: caAt[0], timeZone: caAt[1], city: null };
  const named = COUNTRY_NAMES.find(([re]) => re.test(lower))?.[1];
  return named === undefined
    ? NOTHING
    : { country: named, timeZone: zoneOfCountry(named), city: null };
}

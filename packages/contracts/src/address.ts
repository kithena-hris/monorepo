import * as z from 'zod';

import { asContact, asPublic, policy } from './classification.js';

/**
 * A postal address, and the rules that make one usable in the country it names.
 *
 * A single `address` textarea would have been a tenth of this file. It is not
 * what a company address is for here: this is the registered address that
 * reaches a payslip, a labour inspector and a tax filing, and every one of
 * those wants the parts separately. A free-text blob has to be re-parsed by
 * whoever needs the province, and re-parsing an address is how a filing goes to
 * the wrong tax office.
 *
 * The country decides almost everything else, which is why the shape is
 * validated against the country rather than against a single global pattern.
 * A five-digit postcode is correct in Spain, wrong in the Netherlands and
 * meaningless in Ireland.
 */

/**
 * The countries a company may be registered in, with the parts of an address
 * that country actually uses.
 *
 * Not all 249 of ISO 3166-1. A list of every country would be honest about the
 * world and dishonest about this file, because a country here is a claim that
 * its subdivisions and postcode rule below are right — and they are only right
 * where somebody checked. Adding one is a few lines and a test; pretending to
 * support one is a filing sent somewhere that does not exist.
 */
export interface CountryRules {
  readonly code: string;
  readonly name: string;
  /**
   * What the country calls the level below itself, as it appears on its own
   * forms. "Province" in Spain, "County" in Ireland, "State" in the US.
   * Labelling a Spanish field "State" is the kind of small wrongness that tells
   * a customer the software was not built for them.
   */
  readonly subdivisionLabel: string;
  /** What the country calls a postcode. */
  readonly postcodeLabel: string;
  /**
   * `null` where the country genuinely has no postcodes, rather than where
   * nobody has filled them in yet. Ireland is the interesting case: Eircode
   * exists and is required, so it is a pattern, not a null.
   */
  readonly postcode: RegExp | null;
  /** An example, shown as placeholder text. Worth more than a description. */
  readonly postcodeExample: string;
  readonly subdivisions: readonly { readonly code: string; readonly name: string }[];
}

/** Spain: 52 provinces, postcode is the province number then two digits. */
const ES_PROVINCES = [
  ['01', 'Álava'], ['02', 'Albacete'], ['03', 'Alicante'], ['04', 'Almería'],
  ['05', 'Ávila'], ['06', 'Badajoz'], ['07', 'Baleares'], ['08', 'Barcelona'],
  ['09', 'Burgos'], ['10', 'Cáceres'], ['11', 'Cádiz'], ['12', 'Castellón'],
  ['13', 'Ciudad Real'], ['14', 'Córdoba'], ['15', 'A Coruña'], ['16', 'Cuenca'],
  ['17', 'Girona'], ['18', 'Granada'], ['19', 'Guadalajara'], ['20', 'Gipuzkoa'],
  ['21', 'Huelva'], ['22', 'Huesca'], ['23', 'Jaén'], ['24', 'León'],
  ['25', 'Lleida'], ['26', 'La Rioja'], ['27', 'Lugo'], ['28', 'Madrid'],
  ['29', 'Málaga'], ['30', 'Murcia'], ['31', 'Navarra'], ['32', 'Ourense'],
  ['33', 'Asturias'], ['34', 'Palencia'], ['35', 'Las Palmas'], ['36', 'Pontevedra'],
  ['37', 'Salamanca'], ['38', 'Santa Cruz de Tenerife'], ['39', 'Cantabria'],
  ['40', 'Segovia'], ['41', 'Sevilla'], ['42', 'Soria'], ['43', 'Tarragona'],
  ['44', 'Teruel'], ['45', 'Toledo'], ['46', 'Valencia'], ['47', 'Valladolid'],
  ['48', 'Bizkaia'], ['49', 'Zamora'], ['50', 'Zaragoza'], ['51', 'Ceuta'],
  ['52', 'Melilla'],
] as const;

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const;

const GB_COUNTRIES = [
  ['ENG', 'England'], ['SCT', 'Scotland'], ['WLS', 'Wales'], ['NIR', 'Northern Ireland'],
] as const;

const DE_LAENDER = [
  ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'],
  ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen'],
] as const;

const FR_REGIONS = [
  ['ARA', 'Auvergne-Rhône-Alpes'], ['BFC', 'Bourgogne-Franche-Comté'], ['BRE', 'Bretagne'],
  ['CVL', 'Centre-Val de Loire'], ['COR', 'Corse'], ['GES', 'Grand Est'],
  ['HDF', 'Hauts-de-France'], ['IDF', 'Île-de-France'], ['NOR', 'Normandie'],
  ['NAQ', 'Nouvelle-Aquitaine'], ['OCC', 'Occitanie'], ['PDL', 'Pays de la Loire'],
  ["PAC", "Provence-Alpes-Côte d'Azur"],
] as const;

const IE_COUNTIES = [
  ['CW', 'Carlow'], ['CN', 'Cavan'], ['CE', 'Clare'], ['CO', 'Cork'], ['DL', 'Donegal'],
  ['D', 'Dublin'], ['G', 'Galway'], ['KY', 'Kerry'], ['KE', 'Kildare'], ['KK', 'Kilkenny'],
  ['LS', 'Laois'], ['LM', 'Leitrim'], ['LK', 'Limerick'], ['LD', 'Longford'], ['LH', 'Louth'],
  ['MO', 'Mayo'], ['MH', 'Meath'], ['MN', 'Monaghan'], ['OY', 'Offaly'], ['RN', 'Roscommon'],
  ['SO', 'Sligo'], ['TA', 'Tipperary'], ['WD', 'Waterford'], ['WH', 'Westmeath'],
  ['WX', 'Wexford'], ['WW', 'Wicklow'],
] as const;

const NL_PROVINCES = [
  ['DR', 'Drenthe'], ['FL', 'Flevoland'], ['FR', 'Fryslân'], ['GE', 'Gelderland'],
  ['GR', 'Groningen'], ['LI', 'Limburg'], ['NB', 'Noord-Brabant'], ['NH', 'Noord-Holland'],
  ['OV', 'Overijssel'], ['UT', 'Utrecht'], ['ZE', 'Zeeland'], ['ZH', 'Zuid-Holland'],
] as const;

const PT_DISTRICTS = [
  ['01', 'Aveiro'], ['02', 'Beja'], ['03', 'Braga'], ['04', 'Bragança'],
  ['05', 'Castelo Branco'], ['06', 'Coimbra'], ['07', 'Évora'], ['08', 'Faro'],
  ['09', 'Guarda'], ['10', 'Leiria'], ['11', 'Lisboa'], ['12', 'Portalegre'],
  ['13', 'Porto'], ['14', 'Santarém'], ['15', 'Setúbal'], ['16', 'Viana do Castelo'],
  ['17', 'Vila Real'], ['18', 'Viseu'], ['20', 'Açores'], ['30', 'Madeira'],
] as const;

const IT_REGIONS = [
  ['ABR', 'Abruzzo'], ['BAS', 'Basilicata'], ['CAL', 'Calabria'], ['CAM', 'Campania'],
  ['EMR', 'Emilia-Romagna'], ['FVG', 'Friuli-Venezia Giulia'], ['LAZ', 'Lazio'],
  ['LIG', 'Liguria'], ['LOM', 'Lombardia'], ['MAR', 'Marche'], ['MOL', 'Molise'],
  ['PIE', 'Piemonte'], ['PUG', 'Puglia'], ['SAR', 'Sardegna'], ['SIC', 'Sicilia'],
  ['TOS', 'Toscana'], ['TAA', 'Trentino-Alto Adige'], ['UMB', 'Umbria'],
  ["VDA", "Valle d'Aosta"], ['VEN', 'Veneto'],
] as const;

const IN_STATES = [
  ['AN', 'Andaman and Nicobar Islands'], ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'],
  ['AS', 'Assam'], ['BR', 'Bihar'], ['CH', 'Chandigarh'], ['CT', 'Chhattisgarh'],
  ['DH', 'Dadra and Nagar Haveli and Daman and Diu'], ['DL', 'Delhi'], ['GA', 'Goa'],
  ['GJ', 'Gujarat'], ['HR', 'Haryana'], ['HP', 'Himachal Pradesh'], ['JK', 'Jammu and Kashmir'],
  ['JH', 'Jharkhand'], ['KA', 'Karnataka'], ['KL', 'Kerala'], ['LA', 'Ladakh'],
  ['LD', 'Lakshadweep'], ['MP', 'Madhya Pradesh'], ['MH', 'Maharashtra'], ['MN', 'Manipur'],
  ['ML', 'Meghalaya'], ['MZ', 'Mizoram'], ['NL', 'Nagaland'], ['OR', 'Odisha'],
  ['PY', 'Puducherry'], ['PB', 'Punjab'], ['RJ', 'Rajasthan'], ['SK', 'Sikkim'],
  ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['TR', 'Tripura'], ['UP', 'Uttar Pradesh'],
  ['UT', 'Uttarakhand'], ['WB', 'West Bengal'],
] as const;

const CA_PROVINCES = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'],
  ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Québec'],
  ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
] as const;

const AU_STATES = [
  ['ACT', 'Australian Capital Territory'], ['NSW', 'New South Wales'],
  ['NT', 'Northern Territory'], ['QLD', 'Queensland'], ['SA', 'South Australia'],
  ['TAS', 'Tasmania'], ['VIC', 'Victoria'], ['WA', 'Western Australia'],
] as const;

const pairs = (
  list: readonly (readonly [string, string])[],
): readonly { code: string; name: string }[] => list.map(([code, name]) => ({ code, name }));

export const COUNTRIES: readonly CountryRules[] = [
  {
    code: 'ES', name: 'Spain', subdivisionLabel: 'Province', postcodeLabel: 'Código postal',
    // 01000–52999. The first two digits are the province, which is why the
    // cross-check below can catch a Madrid postcode filed against Barcelona.
    postcode: /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/, postcodeExample: '28013',
    subdivisions: pairs(ES_PROVINCES),
  },
  {
    code: 'GB', name: 'United Kingdom', subdivisionLabel: 'Country', postcodeLabel: 'Postcode',
    postcode: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, postcodeExample: 'SW1A 1AA',
    subdivisions: pairs(GB_COUNTRIES),
  },
  {
    code: 'US', name: 'United States', subdivisionLabel: 'State', postcodeLabel: 'ZIP code',
    postcode: /^\d{5}(?:-\d{4})?$/, postcodeExample: '94107',
    subdivisions: pairs(US_STATES),
  },
  {
    code: 'DE', name: 'Germany', subdivisionLabel: 'Bundesland', postcodeLabel: 'PLZ',
    postcode: /^\d{5}$/, postcodeExample: '10115',
    subdivisions: pairs(DE_LAENDER),
  },
  {
    code: 'FR', name: 'France', subdivisionLabel: 'Région', postcodeLabel: 'Code postal',
    postcode: /^\d{5}$/, postcodeExample: '75001',
    subdivisions: pairs(FR_REGIONS),
  },
  {
    code: 'IT', name: 'Italy', subdivisionLabel: 'Regione', postcodeLabel: 'CAP',
    postcode: /^\d{5}$/, postcodeExample: '00184',
    subdivisions: pairs(IT_REGIONS),
  },
  {
    code: 'PT', name: 'Portugal', subdivisionLabel: 'Distrito', postcodeLabel: 'Código postal',
    postcode: /^\d{4}-\d{3}$/, postcodeExample: '1000-001',
    subdivisions: pairs(PT_DISTRICTS),
  },
  {
    code: 'NL', name: 'Netherlands', subdivisionLabel: 'Provincie', postcodeLabel: 'Postcode',
    // Four digits then two letters. `SA`, `SD` and `SS` are excluded: they were
    // Nazi-era abbreviations and the Dutch postal service does not issue them.
    postcode: /^\d{4}\s?(?!SA|SD|SS)[A-Z]{2}$/i, postcodeExample: '1012 AB',
    subdivisions: pairs(NL_PROVINCES),
  },
  {
    code: 'IE', name: 'Ireland', subdivisionLabel: 'County', postcodeLabel: 'Eircode',
    postcode: /^[AC-FHKNPRTV-Y]\d{2}\s?[AC-FHKNPRTV-Y0-9]{4}$/i, postcodeExample: 'D02 AF30',
    subdivisions: pairs(IE_COUNTIES),
  },
  {
    code: 'IN', name: 'India', subdivisionLabel: 'State', postcodeLabel: 'PIN code',
    // Six digits, first never zero.
    postcode: /^[1-9]\d{5}$/, postcodeExample: '560001',
    subdivisions: pairs(IN_STATES),
  },
  {
    code: 'CA', name: 'Canada', subdivisionLabel: 'Province', postcodeLabel: 'Postal code',
    postcode: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
    postcodeExample: 'K1A 0B1',
    subdivisions: pairs(CA_PROVINCES),
  },
  {
    code: 'AU', name: 'Australia', subdivisionLabel: 'State', postcodeLabel: 'Postcode',
    postcode: /^\d{4}$/, postcodeExample: '2000',
    subdivisions: pairs(AU_STATES),
  },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryRules(code: string): CountryRules | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export const CountryCode = z
  .string()
  .refine((c) => BY_CODE.has(c.toUpperCase()), 'that country is not supported yet')
  .register(policy, asPublic());

/**
 * The address as stored.
 *
 * `line2` is where a door, floor, stair or unit goes. It is one optional field
 * rather than a `door` and a `floor` and a `staircase`, because which of those
 * exist differs by country — a Spanish address has `3º izquierda`, a US one has
 * `Apt 4B`, and modelling the union of every country's building parts produces
 * a form where most fields are blank and none is required.
 *
 * `city` is free text on purpose. Subdivisions are a closed list that changes
 * on the order of decades; municipalities number in the tens of thousands and
 * change constantly, and a stale dropdown that cannot express where somebody
 * actually is, is worse than a text field.
 */
export const PostalAddress = z.object({
  country: CountryCode,
  line1: z.string().trim().min(1, 'a street address is needed').max(200).register(policy, asContact()),
  line2: z.string().trim().max(200).nullable().register(policy, asContact()),
  city: z.string().trim().min(1, 'a city or town is needed').max(120).register(policy, asContact()),
  subdivision: z.string().trim().max(80).nullable().register(policy, asContact()),
  postcode: z.string().trim().max(24).nullable().register(policy, asContact()),
});
export type PostalAddress = z.infer<typeof PostalAddress>;

export interface AddressProblem {
  readonly field: keyof PostalAddress;
  readonly message: string;
}

/**
 * The country-dependent half of the rules.
 *
 * Separate from the Zod object rather than a `superRefine` on it, because these
 * checks are the ones a form runs per keystroke on one field. A refinement
 * would make that an all-or-nothing parse and the form would have to discard
 * everything it learned about the other fields to ask about one.
 */
export function checkAddress(address: PostalAddress): readonly AddressProblem[] {
  const problems: AddressProblem[] = [];
  const rules = countryRules(address.country);
  if (!rules) return [{ field: 'country', message: 'that country is not supported yet' }];

  if (rules.subdivisions.length > 0) {
    const known = rules.subdivisions.some((s) => s.code === address.subdivision);
    if (!known) {
      problems.push({
        field: 'subdivision',
        message: `choose a ${rules.subdivisionLabel.toLowerCase()}`,
      });
    }
  }

  if (rules.postcode) {
    const postcode = address.postcode ?? '';
    if (postcode === '') {
      problems.push({ field: 'postcode', message: `a ${rules.postcodeLabel} is needed` });
    } else if (!rules.postcode.test(postcode)) {
      problems.push({
        field: 'postcode',
        message: `that is not a ${rules.postcodeLabel} — for example ${rules.postcodeExample}`,
      });
    }
  }

  // Spain numbers its provinces and starts every postcode with that number, so
  // the two fields can contradict each other in a way no per-field check sees.
  // Worth catching: a payroll filing goes to the province, and a Madrid
  // postcode filed against Barcelona is a filing to the wrong tax office.
  if (
    address.country.toUpperCase() === 'ES' &&
    address.subdivision !== null &&
    address.postcode !== null &&
    /^\d{5}$/.test(address.postcode) &&
    address.postcode.slice(0, 2) !== address.subdivision
  ) {
    const province = rules.subdivisions.find((s) => s.code === address.subdivision);
    problems.push({
      field: 'postcode',
      message: `a ${province?.name ?? 'that province'} postcode starts ${address.subdivision}`,
    });
  }

  return problems;
}

/** Whether an address is complete and internally consistent. */
export function isUsableAddress(address: PostalAddress): boolean {
  return PostalAddress.safeParse(address).success && checkAddress(address).length === 0;
}

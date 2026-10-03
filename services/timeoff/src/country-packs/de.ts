import { holidayLayer, statutoryType, type TimeOffCountryPack } from './pack.js';

/**
 * Germany (PRD §12.3, TOF-113). Data only, `reviewed: false` until somebody
 * who knows German employment law signs it off.
 *
 * Sources, as of October 2026:
 * - Bundesurlaubsgesetz (BUrlG) §3(1): 24 Werktage a year, counted over a
 *   six-day week — 20 working days on five.
 * - Entgeltfortzahlungsgesetz (EFZG) §3: six weeks' sick pay from the
 *   employer; §5(1): a doctor's certificate when an illness lasts more than
 *   three calendar days.
 * - Mutterschutzgesetz (MuSchG) §3: six weeks before the expected birth and
 *   eight after (twelve after a premature or multiple birth); paid as
 *   Mutterschaftsgeld by the health insurer and topped up by the employer (§20).
 * - Bundeselterngeld- und Elternzeitgesetz (BEEG) §15, §16: Elternzeit up to
 *   three years per parent before the child turns eight, unpaid by the
 *   employer (Elterngeld comes from the state); notice of seven weeks before
 *   the third birthday, thirteen after.
 * - Pflegezeitgesetz (PflegeZG) §2: up to ten working days to arrange care
 *   for a close relative in an acute case.
 * - BGB §616: a short paid absence for a personal reason (a wedding, a
 *   funeral), which a contract or collective agreement may narrow or exclude.
 * - SGB V §45: a child's sickness, paid by the health insurer (Kinderkrankengeld);
 *   the number of days has changed year to year, so the pack states none.
 * - Arbeitszeitgesetz (ArbZG) §5: eleven hours' rest; §16(2): the record of
 *   hours kept two years.
 * - Holidays: the federal days (Neujahr, Karfreitag, Ostermontag, Tag der
 *   Arbeit, Christi Himmelfahrt, Pfingstmontag, Tag der Deutschen Einheit,
 *   both Christmas days) are in every state's Feiertagsgesetz; Bavaria's
 *   Feiertagsgesetz (FTG) Art. 1 adds Heilige Drei Könige, Fronleichnam,
 *   Allerheiligen and — in municipalities with a mainly Catholic population,
 *   Munich among them — Mariä Himmelfahrt; Berlin's Feiertagsgesetz adds the
 *   Internationaler Frauentag (8 March). Germany never moves a holiday off a
 *   weekend. Easter 2026 is 5 April, 2027 28 March.
 */

/** A short paid absence under BGB §616: shown to teammates as "Away". */
const shortAbsence = {
  category: 'other',
  colorToken: 'fg-3',
  icon: 'plane',
  tracked: false,
  paid: 'paid',
} as const;

const leaveTypes = [
  statutoryType(
    'vacation',
    'Vacation',
    { de: 'Urlaub' },
    {
      category: 'annual_leave',
      colorToken: 'chart-1',
      icon: 'sun',
      tracked: true,
      paid: 'paid',
      visibility: 'type',
    },
  ),
  statutoryType(
    'sick',
    'Sick',
    { de: 'Arbeitsunfähigkeit' },
    {
      category: 'sick_leave',
      colorToken: 'chart-5',
      icon: 'thermometer',
      tracked: false,
      paid: 'paid',
      visibility: 'off_only',
      requiresNote: { afterDays: 3 },
    },
  ),
  statutoryType(
    'child_sick',
    'Child sick',
    { de: 'Kinderkrankentage' },
    {
      category: 'sick_leave',
      colorToken: 'chart-5',
      icon: 'thermometer',
      tracked: false,
      paid: 'statutory',
      visibility: 'off_only',
      requiresNote: { afterDays: 1 },
    },
  ),
  statutoryType(
    'maternity_protection',
    'Maternity protection',
    { de: 'Mutterschutz' },
    {
      category: 'parental_leave',
      colorToken: 'chart-3',
      icon: 'baby',
      tracked: false,
      paid: 'statutory',
      visibility: 'off_only',
    },
  ),
  statutoryType(
    'parental',
    'Parental leave',
    { de: 'Elternzeit' },
    {
      category: 'parental_leave',
      colorToken: 'chart-6',
      icon: 'baby',
      tracked: false,
      paid: 'unpaid',
      visibility: 'off_only',
    },
  ),
  statutoryType(
    'care',
    'Care for a relative',
    { de: 'Kurzzeitige Arbeitsverhinderung' },
    {
      category: 'other',
      colorToken: 'fg-3',
      icon: 'plane',
      tracked: false,
      paid: 'statutory',
      visibility: 'off_only',
    },
  ),
  statutoryType(
    'personal',
    'Personal reasons',
    { de: 'Vorübergehende Verhinderung' },
    {
      ...shortAbsence,
      visibility: 'off_only',
    },
  ),
];

const entitlements: TimeOffCountryPack['entitlements'] = {
  vacation: { days: 20, counted: 'working', per: 'year' }, // BUrlG §3(1), five-day week
  maternity_protection: { days: 98, counted: 'calendar', per: 'event' }, // MuSchG §3: 6 + 8 weeks
  care: { days: 10, counted: 'working', per: 'event' }, // PflegeZG §2(1)
};

const national = holidayLayer('de', 'Germany', 'national', 'none', [
  ['2026-01-01', 'Neujahr'],
  ['2026-04-03', 'Karfreitag'],
  ['2026-04-06', 'Ostermontag'],
  ['2026-05-01', 'Tag der Arbeit'],
  ['2026-05-14', 'Christi Himmelfahrt'],
  ['2026-05-25', 'Pfingstmontag'],
  ['2026-10-03', 'Tag der Deutschen Einheit'],
  ['2026-12-25', '1. Weihnachtstag'],
  ['2026-12-26', '2. Weihnachtstag'],
  ['2027-01-01', 'Neujahr'],
  ['2027-03-26', 'Karfreitag'],
  ['2027-03-29', 'Ostermontag'],
  ['2027-05-01', 'Tag der Arbeit'],
  ['2027-05-06', 'Christi Himmelfahrt'],
  ['2027-05-17', 'Pfingstmontag'],
  ['2027-10-03', 'Tag der Deutschen Einheit'],
  ['2027-12-25', '1. Weihnachtstag'],
  ['2027-12-26', '2. Weihnachtstag'],
]);

// Mariä Himmelfahrt only where the population is mainly Catholic (FTG Art. 1(1) Nr. 2), Munich among them.
const bayern = holidayLayer('de_by', 'Bavaria', 'regional', 'none', [
  ['2026-01-06', 'Heilige Drei Könige'],
  ['2026-06-04', 'Fronleichnam'],
  ['2026-08-15', 'Mariä Himmelfahrt'],
  ['2026-11-01', 'Allerheiligen'],
  ['2027-01-06', 'Heilige Drei Könige'],
  ['2027-05-27', 'Fronleichnam'],
  ['2027-08-15', 'Mariä Himmelfahrt'],
  ['2027-11-01', 'Allerheiligen'],
]);

const berlin = holidayLayer('de_be', 'Berlin', 'regional', 'none', [
  ['2026-03-08', 'Internationaler Frauentag'],
  ['2027-03-08', 'Internationaler Frauentag'],
]);

export const de = {
  country: 'DE',
  version: 1,
  reviewed: false,
  leaveTypes,
  entitlements,
  holidayLayers: [national, bayern, berlin],
  calendars: {
    munich: [national, bayern],
    berlin: [national, berlin],
  },
  // ArbZG §5(1): eleven hours' rest. §16(2): the record of hours kept two years.
  attendance: { minimumRestHours: 11, retentionYears: 2 },
  parental: null,
} satisfies TimeOffCountryPack;

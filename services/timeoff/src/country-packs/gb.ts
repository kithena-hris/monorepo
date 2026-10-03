import { holidayLayer, statutoryType, type TimeOffCountryPack } from './pack.js';

/**
 * The United Kingdom (PRD §12.3, TOF-113). Data only, `reviewed: false` until
 * somebody who knows UK employment law signs it off. Northern Ireland has
 * holidays of its own and no layer here yet.
 *
 * Sources, as of October 2026:
 * - Working Time Regulations 1998 (WTR) regs 13 and 13A: 5.6 weeks' leave a
 *   year, 28 days on a five-day week, which may include the bank holidays;
 *   reg 10: eleven hours' rest; reg 9: working-hours records kept two years;
 *   reg 16B (from 6 April 2026, Employment Rights Act 2025 s.35): records of
 *   annual leave and holiday pay kept six years.
 * - Statutory Sick Pay (Social Security Contributions and Benefits Act 1992,
 *   Part XI) and the Statutory Sick Pay (Medical Evidence) Regulations 1985:
 *   an employee self-certifies the first seven days, a fit note after.
 * - Employment Rights Act 1996 (ERA) ss.71–73 and the Maternity and Parental
 *   Leave etc. Regulations 1999: 52 weeks' maternity leave, two compulsory
 *   after the birth (reg 8); Statutory Maternity Pay for 39 weeks.
 * - The Paternity and Adoption Leave Regulations 2002 as amended in 2024:
 *   two weeks' paternity leave, taken as one block or two single weeks within
 *   52 weeks of the birth; adoption leave mirrors maternity leave.
 * - The Shared Parental Leave Regulations 2014: up to 50 weeks shared,
 *   curtailed from maternity or adoption leave.
 * - MPL Regulations 1999 Part III: 18 weeks' unpaid parental leave per child
 *   before the child turns 18, at most four weeks a year.
 * - ERA s.57A: reasonable unpaid time off for dependants in an emergency.
 * - Carer's Leave Act 2023 and Regulations 2024: one week a year, unpaid.
 * - Neonatal Care (Leave and Pay) Act 2023, in force 6 April 2025: up to 12
 *   weeks while a newborn is in neonatal care.
 * - Parental Bereavement (Leave and Pay) Act 2018: two weeks.
 * - The Bereaved Partner's Paternity Leave Regulations 2026 (SI 2026/237),
 *   from 6 April 2026, Great Britain only: unpaid leave from the day after the
 *   mother's or main adopter's death, in one block, ending by the child's
 *   first birthday or placement anniversary — up to 52 weeks.
 * - Bank holidays: the Banking and Financial Dealings Act 1971 and the
 *   dates the UK Government publishes at gov.uk/bank-holidays for England and
 *   Wales and for Scotland, including Scotland's one-off World Cup bank
 *   holiday on 15 June 2026. A holiday on a weekend is observed on the next
 *   working day ("substitute day"), which the layer's rule computes rather
 *   than listing. Easter 2026 is 5 April, 2027 28 March.
 */

const leaveTypes = [
  statutoryType(
    'vacation',
    'Annual leave',
    {},
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
    {},
    {
      category: 'sick_leave',
      colorToken: 'chart-5',
      icon: 'thermometer',
      tracked: false,
      paid: 'statutory',
      visibility: 'off_only',
      requiresNote: { afterDays: 7 },
    },
  ),
  statutoryType(
    'maternity',
    'Maternity leave',
    {},
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
    'paternity',
    'Paternity leave',
    {},
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
    'adoption',
    'Adoption leave',
    {},
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
    'shared_parental',
    'Shared parental leave',
    {},
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
    'neonatal_care',
    'Neonatal care leave',
    {},
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
    'parental_unpaid',
    'Parental leave, unpaid',
    {},
    {
      category: 'parental_leave',
      colorToken: 'chart-6',
      icon: 'circle-slash',
      tracked: false,
      paid: 'unpaid',
      visibility: 'off_only',
    },
  ),
  statutoryType(
    'dependants',
    'Time off for dependants',
    {},
    {
      category: 'unpaid_leave',
      colorToken: 'fg-3',
      icon: 'plane',
      tracked: false,
      paid: 'unpaid',
      visibility: 'off_only',
    },
  ),
  statutoryType(
    'carers',
    'Carer’s leave',
    {},
    {
      category: 'unpaid_leave',
      colorToken: 'fg-3',
      icon: 'plane',
      tracked: false,
      paid: 'unpaid',
      visibility: 'off_only',
    },
  ),
  statutoryType(
    'parental_bereavement',
    'Parental bereavement leave',
    {},
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
    'bereaved_partner_paternity',
    'Bereaved partner’s paternity leave',
    {},
    {
      category: 'parental_leave',
      colorToken: 'chart-6',
      icon: 'baby',
      tracked: false,
      paid: 'unpaid',
      visibility: 'off_only',
    },
  ),
];

const entitlements: TimeOffCountryPack['entitlements'] = {
  vacation: { days: 28, counted: 'working', per: 'year' }, // WTR regs 13, 13A: 5.6 weeks
  maternity: { days: 364, counted: 'calendar', per: 'event' }, // ERA ss.71–73: 52 weeks
  paternity: { days: 14, counted: 'calendar', per: 'event' }, // PAL Regs 2002: 2 weeks
  adoption: { days: 364, counted: 'calendar', per: 'event' }, // PAL Regs 2002: 52 weeks
  shared_parental: { days: 350, counted: 'calendar', per: 'event' }, // SPL Regs 2014: 50 weeks
  neonatal_care: { days: 84, counted: 'calendar', per: 'event' }, // 2023 Act: 12 weeks
  parental_unpaid: { days: 126, counted: 'calendar', per: 'event' }, // 18 weeks per child
  carers: { days: 5, counted: 'working', per: 'year' }, // one working week
  parental_bereavement: { days: 14, counted: 'calendar', per: 'event' }, // 2018 Act: 2 weeks
  bereaved_partner_paternity: { days: 364, counted: 'calendar', per: 'event' }, // SI 2026/237: up to 52 weeks
};

/** The days England and Wales and Scotland share. */
const national = holidayLayer('gb', 'United Kingdom', 'national', 'move_to_monday', [
  ['2026-01-01', 'New Year’s Day'],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-04', 'Early May bank holiday'],
  ['2026-05-25', 'Spring bank holiday'],
  ['2026-12-25', 'Christmas Day'],
  ['2026-12-26', 'Boxing Day'],
  ['2027-01-01', 'New Year’s Day'],
  ['2027-03-26', 'Good Friday'],
  ['2027-05-03', 'Early May bank holiday'],
  ['2027-05-31', 'Spring bank holiday'],
  ['2027-12-25', 'Christmas Day'],
  ['2027-12-26', 'Boxing Day'],
]);

const englandAndWales = holidayLayer('gb_eaw', 'England and Wales', 'regional', 'move_to_monday', [
  ['2026-04-06', 'Easter Monday'],
  ['2026-08-31', 'Summer bank holiday'],
  ['2027-03-29', 'Easter Monday'],
  ['2027-08-30', 'Summer bank holiday'],
]);

const scotland = holidayLayer('gb_sct', 'Scotland', 'regional', 'move_to_monday', [
  ['2026-01-02', '2nd January'],
  ['2026-06-15', 'World Cup bank holiday'],
  ['2026-08-03', 'Summer bank holiday'],
  ['2026-11-30', 'St Andrew’s Day'],
  ['2027-01-02', '2nd January'],
  ['2027-08-02', 'Summer bank holiday'],
  ['2027-11-30', 'St Andrew’s Day'],
]);

export const gb = {
  country: 'GB',
  version: 1,
  reviewed: false,
  leaveTypes,
  entitlements,
  holidayLayers: [national, englandAndWales, scotland],
  calendars: {
    london: [national, englandAndWales],
    edinburgh: [national, scotland],
  },
  // WTR reg 10: eleven hours' rest. Reg 16B: leave records kept six years,
  // longer than reg 9's two for hours, so the longer one wins.
  attendance: { minimumRestHours: 11, retentionYears: 6 },
  parental: null,
} satisfies TimeOffCountryPack;

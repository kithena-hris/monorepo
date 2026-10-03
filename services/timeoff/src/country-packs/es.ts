import { CalendarDate, LeaveTypeDefinition } from '@kithena/contracts';

import type { HolidayLayer } from '../domain/calendar/holiday-calendar.js';

/**
 * Spain (PRD §12.3): what a Spanish tenant starts with.
 *
 * Data, not code paths, in the way People's country packs are. A tenant
 * accepts the pack and every leave type is then theirs to rename or hide,
 * never to delete (TOF-012).
 *
 * `reviewed: false` until somebody who knows Spanish employment law signs it
 * off; settings shows the flag, and the pack is not enabled for a tenant
 * before then.
 *
 * Sources, as of October 2026: Estatuto de los Trabajadores arts. 34, 37, 38,
 * 48 and 48 bis as amended by RDL 5/2023 and RDL 9/2025; the BOE list of
 * fiestas laborales for 2026 (Resolución de 17 de octubre de 2025); Comunidad
 * de Madrid Decreto 75/2025 (2026) and its 2027 decree of 30 September 2026;
 * Catalonia's Ordre EMT/66/2025 (2026) and its 2027 order; the Madrid and
 * Barcelona city councils' local days for 2026 and 2027.
 */

export interface TimeOffCountryPack {
  readonly country: 'ES';
  readonly version: number;
  readonly reviewed: boolean;
  readonly leaveTypes: readonly LeaveTypeDefinition[];
  /** How much of a statutory type the law grants. Read by the policy fold and the request rules. */
  readonly entitlements: Readonly<
    Record<
      string,
      {
        readonly days: number;
        readonly counted: 'calendar' | 'working';
        readonly per: 'year' | 'event';
      }
    >
  >;
  readonly holidayLayers: readonly HolidayLayer[];
  /** Layers by work location, most general first (§10.2). */
  readonly calendars: Readonly<Record<'madrid' | 'barcelona', readonly HolidayLayer[]>>;
  readonly attendance: { readonly minimumRestHours: number; readonly retentionYears: number };
  readonly parental: typeof parental;
}

const type = (
  key: string,
  name: string,
  spanish: string,
  rest: Pick<
    LeaveTypeDefinition,
    'category' | 'colorToken' | 'icon' | 'tracked' | 'paid' | 'visibility'
  > &
    Partial<Pick<LeaveTypeDefinition, 'requiresNote'>>,
): LeaveTypeDefinition =>
  LeaveTypeDefinition.parse({
    key,
    name: { default: name, translations: { es: spanish } },
    statutory: true,
    ...rest,
  });

/** A paid leave of absence (permiso retribuido): shown to teammates as "Away". */
const permiso = {
  category: 'other',
  colorToken: 'fg-3',
  icon: 'plane',
  tracked: false,
  paid: 'paid',
} as const;

const leaveTypes = [
  type('vacation', 'Vacation', 'Vacaciones', {
    category: 'annual_leave',
    colorToken: 'chart-1',
    icon: 'sun',
    tracked: true,
    paid: 'paid',
    visibility: 'type',
  }),
  // Incapacidad temporal: the doctor's parte de baja, paid by Social Security
  // and the employer between them. The note rule is the PRD's default.
  type('sick', 'Sick', 'Baja por enfermedad', {
    category: 'sick_leave',
    colorToken: 'chart-5',
    icon: 'thermometer',
    tracked: false,
    paid: 'statutory',
    visibility: 'off_only',
    requiresNote: { afterDays: 3 },
  }),
  // Art. 48.4: nacimiento y cuidado del menor, 19 weeks, paid by Social Security.
  type('parental', 'Parental leave', 'Nacimiento y cuidado del menor', {
    category: 'parental_leave',
    colorToken: 'chart-3',
    icon: 'baby',
    tracked: false,
    paid: 'statutory',
    visibility: 'off_only',
  }),
  // Art. 48 bis: permiso parental, up to 8 weeks until the child is 8, unpaid.
  type('parental_unpaid', 'Parental leave, unpaid', 'Permiso parental', {
    category: 'parental_leave',
    colorToken: 'chart-6',
    icon: 'circle-slash',
    tracked: false,
    paid: 'unpaid',
    visibility: 'off_only',
  }),
  type('marriage', 'Marriage or civil partnership', 'Matrimonio o pareja de hecho', {
    ...permiso,
    visibility: 'type',
  }),
  // Art. 37.3.b: a relative's accident, serious illness, hospitalisation or surgery. Their health, so "Away".
  type(
    'family_care',
    'Family member ill or in hospital',
    'Enfermedad grave u hospitalización de familiar',
    {
      ...permiso,
      visibility: 'off_only',
    },
  ),
  type('bereavement', 'Bereavement', 'Fallecimiento de familiar', {
    ...permiso,
    visibility: 'off_only',
  }),
  type('moving', 'Moving home', 'Traslado de domicilio', { ...permiso, visibility: 'type' }),
  // Art. 37.9: urgent family reasons, up to four days a year.
  type('force_majeure', 'Urgent family reasons', 'Fuerza mayor familiar', {
    ...permiso,
    visibility: 'off_only',
  }),
];

const entitlements: TimeOffCountryPack['entitlements'] = {
  vacation: { days: 30, counted: 'calendar', per: 'year' }, // art. 38: never fewer than 30 calendar days
  marriage: { days: 15, counted: 'calendar', per: 'event' }, // art. 37.3.a
  family_care: { days: 5, counted: 'working', per: 'event' }, // art. 37.3.b
  bereavement: { days: 2, counted: 'working', per: 'event' }, // art. 37.3.b bis; 4 when travel is needed
  moving: { days: 1, counted: 'working', per: 'event' }, // art. 37.3.c
  force_majeure: { days: 4, counted: 'working', per: 'year' }, // art. 37.9
};

const layer = (
  key: string,
  name: string,
  level: HolidayLayer['level'],
  holidays: readonly (readonly [string, string])[],
): HolidayLayer => ({
  key,
  name,
  level,
  // Spain's regions publish a moved day as a date of their own, so no layer moves anything by rule.
  weekendRule: 'none',
  holidays: holidays.map(([date, holiday]) => ({ date: CalendarDate.parse(date), name: holiday })),
});

/*
 * The national layer is the days every community keeps. 2027's is the days
 * both Madrid's and Catalonia's published 2027 calendars share, pending the
 * BOE list that comes out at the end of October: Madrid moves the Sunday
 * Asunción to Monday 16 August and Catalonia does not, so it sits in Madrid's
 * layer, not here.
 */
const national = layer('es', 'Spain', 'national', [
  ['2026-01-01', 'Año Nuevo'],
  ['2026-01-06', 'Epifanía'],
  ['2026-04-03', 'Viernes Santo'],
  ['2026-05-01', 'Fiesta del Trabajo'],
  ['2026-08-15', 'Asunción'],
  ['2026-10-12', 'Fiesta Nacional'],
  ['2026-12-08', 'Inmaculada Concepción'],
  ['2026-12-25', 'Navidad'],
  ['2027-01-01', 'Año Nuevo'],
  ['2027-01-06', 'Epifanía'],
  ['2027-03-26', 'Viernes Santo'],
  ['2027-05-01', 'Fiesta del Trabajo'],
  ['2027-10-12', 'Fiesta Nacional'],
  ['2027-11-01', 'Todos los Santos'],
  ['2027-12-06', 'Día de la Constitución'],
  ['2027-12-08', 'Inmaculada Concepción'],
  ['2027-12-25', 'Navidad'],
]);

const comunidadDeMadrid = layer('es_md', 'Madrid region', 'regional', [
  ['2026-04-02', 'Jueves Santo'],
  ['2026-05-02', 'Fiesta de la Comunidad de Madrid'],
  ['2026-11-02', 'Todos los Santos (trasladado)'],
  ['2026-12-07', 'Día de la Constitución (trasladado)'],
  ['2027-03-19', 'San José'],
  ['2027-03-25', 'Jueves Santo'],
  ['2027-08-16', 'Asunción (trasladada)'],
]);

const catalunya = layer('es_ct', 'Catalonia', 'regional', [
  ['2026-04-06', 'Dilluns de Pasqua Florida'],
  ['2026-06-24', 'Sant Joan'],
  ['2026-09-11', 'Diada Nacional de Catalunya'],
  ['2026-12-26', 'Sant Esteve'],
  ['2027-03-29', 'Dilluns de Pasqua Florida'],
  ['2027-06-24', 'Sant Joan'],
  ['2027-09-11', 'Diada Nacional de Catalunya'],
]);

const madridCity = layer('madrid', 'Madrid city', 'city', [
  ['2026-05-15', 'San Isidro'],
  ['2026-11-09', 'La Almudena'],
  ['2027-05-15', 'San Isidro'],
  ['2027-11-09', 'La Almudena'],
]);

const barcelonaCity = layer('barcelona', 'Barcelona city', 'city', [
  ['2026-05-25', 'Segona Pasqua'],
  ['2026-09-24', 'La Mercè'],
  ['2027-05-17', 'Segona Pasqua'],
  ['2027-09-24', 'La Mercè'],
]);

/**
 * Nacimiento y cuidado del menor, ET art. 48.4 as RDL 9/2025 left it. Used by
 * the parental planner in Phase 3 (TOF-100 onwards); data until then.
 */
const parental = {
  law: 'ET art. 48.4, RDL 9/2025',
  paidBy: 'social_security',
  payPercent: 100,
  /** Each parent's own weeks. Not transferable between them. */
  twoParents: { mandatoryWeeks: 6, flexibleWeeks: 11, laterWeeks: 2 },
  singleParent: { mandatoryWeeks: 6, flexibleWeeks: 22, laterWeeks: 4 },
  /** Mandatory weeks run full time straight after the birth, or the adoption or fostering decision. */
  mandatoryStarts: 'at_birth_or_decision',
  /** Flexible weeks are taken in whole weeks before the child is 1 (12 months from the decision for adoption). */
  flexibleUntilMonths: 12,
  /** Later weeks, also whole weeks, before the child is 8. */
  laterUntilYears: 8,
  /** The birth mother may start up to 4 weeks before the due date. */
  birthParentMayStartWeeksBefore: 4,
  /** Per child after the first, and for a child with a disability: one week each, both to a single parent. */
  extraWeeks: { twoParents: 1, singleParent: 2 },
  /** Notice the employer is owed for each flexible block. */
  noticeDays: 15,
  /** Art. 48 bis permiso parental, unpaid, before the child is 8. */
  unpaidWeeks: 8,
} as const;

export const es: TimeOffCountryPack = {
  country: 'ES',
  version: 1,
  reviewed: false,
  leaveTypes,
  entitlements,
  holidayLayers: [national, comunidadDeMadrid, catalunya, madridCity, barcelonaCity],
  calendars: {
    madrid: [national, comunidadDeMadrid, madridCity],
    barcelona: [national, catalunya, barcelonaCity],
  },
  // Art. 34.3: twelve hours between the end of one day and the start of the next.
  // Art. 34.9: the daily record of hours is kept for four years.
  attendance: { minimumRestHours: 12, retentionYears: 4 },
  parental,
};

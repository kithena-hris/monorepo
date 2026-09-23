import { err, failure, isTimeZone, localDate, ok, type Result } from '@kithena/domain-kit';
import { countryRules, type CalendarDate } from '@kithena/contracts';

/**
 * Whose day it is (PEO-099).
 *
 * A calendar date is not an instant. "Required from the 1st", "last working
 * day plus 48 months", "headcount today" all compare a date with *today*, and
 * at 11:30 UTC on 1 March today is the 2nd in Auckland and the 1st in Los
 * Angeles. So every today in People is an instant read on somebody's calendar,
 * and this file says whose:
 *
 * - **A person's**: their work location's zone, else their legal entity's
 *   default, else their own zone (identity's copy), else the tenant default.
 *   Person-level rules — their required-from, their reminder window, their
 *   retention due date — run on it.
 * - **A legal entity's**: its own default. Company-wide aggregates are counted
 *   per legal entity on that entity's day, and a tenant-wide figure is the sum
 *   of the per-entity figures, each on its own day.
 *
 * Pure. The calendar is loaded once per transaction by the application's
 * `Calendars` port and every rule reads it from here, so there is one answer
 * to "which zone" and one conversion from an instant to a day
 * (`localDate`, in domain-kit).
 */

export interface LegalEntity {
  readonly id: string;
  readonly name: string;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
  /** The entity's default IANA zone. */
  readonly timeZone: string;
}

/** One effective-dated zone of a location. */
export interface LocationZone {
  readonly effectiveFrom: CalendarDate;
  readonly timeZone: string;
}

export interface Location {
  readonly id: string;
  readonly legalEntityId: string;
  readonly name: string;
  readonly country: string;
  /** In force from each `effectiveFrom`, ascending, corrections already applied. */
  readonly zones: readonly LocationZone[];
}

export interface TenantCalendar {
  /** The tenant's default zone: the last resort, never the first. */
  readonly defaultZone: string;
  readonly entities: ReadonlyMap<string, LegalEntity>;
  readonly locations: ReadonlyMap<string, Location>;
}

/** Where a person sits, as far as their calendar is concerned. */
export interface Placement {
  readonly locationId: string | null;
  readonly legalEntityId: string | null;
  /** `custom.time_zone`, from identity. May be anything a row once held. */
  readonly ownZone: string | null;
}

/** Where a person sits, read off their values by attribute key. */
export function placementOf(values: Readonly<Record<string, unknown>>): Placement {
  const text = (key: string): string | null => {
    const value = values[key];
    return typeof value === 'string' ? value : null;
  };
  return {
    locationId: text('location_id'),
    legalEntityId: text('legal_entity_id'),
    ownZone: text('time_zone'),
  };
}

/** A tenant nobody has configured: UTC, and nothing else. */
export const UTC_CALENDAR: TenantCalendar = {
  defaultZone: 'Etc/UTC',
  entities: new Map(),
  locations: new Map(),
};

/**
 * A location's zone at an instant.
 *
 * A version is in force once its effective date has begun *in its own zone*:
 * an office moving to the Canaries from 1 April is on Canary time from
 * midnight on 1 April, Canary time. Before the earliest version, the earliest.
 */
export function locationZoneAt(location: Location, at: string): string | null {
  let zone: string | null = location.zones[0]?.timeZone ?? null;
  for (const version of location.zones) {
    if (localDate(at, version.timeZone) >= version.effectiveFrom) zone = version.timeZone;
  }
  return zone;
}

/** A person's zone at an instant. See the file header for the order. */
export function personZone(calendar: TenantCalendar, placement: Placement, at: string): string {
  const location =
    placement.locationId === null ? undefined : calendar.locations.get(placement.locationId);
  const fromLocation = location === undefined ? null : locationZoneAt(location, at);
  if (fromLocation !== null) return fromLocation;

  const entity =
    placement.legalEntityId === null ? undefined : calendar.entities.get(placement.legalEntityId);
  if (entity !== undefined) return entity.timeZone;

  if (placement.ownZone !== null && isTimeZone(placement.ownZone)) return placement.ownZone;
  return calendar.defaultZone;
}

/** A legal entity's zone; the tenant's for nobody's entity or one the tenant does not have. */
export function entityZone(calendar: TenantCalendar, legalEntityId: string | null): string {
  return (
    (legalEntityId === null ? undefined : calendar.entities.get(legalEntityId))?.timeZone ??
    calendar.defaultZone
  );
}

/** When a reminder may land: working hours, on the person's own clock. */
export const REMINDER_HOURS = { from: 9, until: 18 } as const;

/**
 * Whether it is working hours for somebody in `zone` at `at`.
 *
 * The sweep runs hourly for every tenant at once, so without this a reminder
 * reaches Auckland at 03:00 because Europe had its morning. Hours rather than
 * days: the one-per-week cap is already 168 hours and needs no calendar.
 */
export function inReminderWindow(at: string, zone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(at),
    ),
  );
  return hour >= REMINDER_HOURS.from && hour < REMINDER_HOURS.until;
}

/** Each legal entity's day at an instant, and the tenant's for everybody else. */
export function entityDays(
  calendar: TenantCalendar,
  at: string,
): { readonly byEntity: ReadonlyMap<string, CalendarDate>; readonly fallback: CalendarDate } {
  return {
    byEntity: new Map([...calendar.entities.values()].map((e) => [e.id, localDate(at, e.timeZone)])),
    fallback: localDate(at, calendar.defaultZone),
  };
}

/**
 * The zones of a location as rows hold them, with every superseded row gone.
 *
 * A correction is a new row carrying `supersedes`, never an UPDATE: the
 * mistaken zone stays on file and stops being in force.
 */
export function effectiveZones(
  rows: readonly {
    readonly id: string;
    readonly effectiveFrom: CalendarDate;
    readonly timeZone: string;
    readonly supersedes: string | null;
  }[],
): LocationZone[] {
  const superseded = new Set(rows.map((r) => r.supersedes).filter((s) => s !== null));
  return rows
    .filter((r) => !superseded.has(r.id))
    .toSorted((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .map((r) => ({ effectiveFrom: r.effectiveFrom, timeZone: r.timeZone }));
}

/* ------------------------------------------------------------ writing -- */

export function checkTimeZone(zone: string, path = 'timeZone'): Result<string> {
  return isTimeZone(zone)
    ? ok(zone)
    : err(failure('TIME_ZONE_UNKNOWN', `${zone} is not an IANA time zone`, [path]));
}

function checkCountry(country: string): Result<string> {
  return countryRules(country) === undefined
    ? err(failure('COUNTRY_UNSUPPORTED', `${country} is not a supported country`, ['country']))
    : ok(country.toUpperCase());
}

function checkName(name: string): Result<string> {
  const trimmed = name.trim();
  return trimmed === '' || trimmed.length > 200
    ? err(failure('NAME_REQUIRED', 'A name of 1 to 200 characters is required', ['name']))
    : ok(trimmed);
}

export interface PlaceInput {
  readonly name: string;
  readonly country: string;
  readonly timeZone: string;
}

export function checkLegalEntity(input: PlaceInput): Result<PlaceInput> {
  const name = checkName(input.name);
  if (!name.ok) return name;
  const country = checkCountry(input.country);
  if (!country.ok) return country;
  const zone = checkTimeZone(input.timeZone);
  if (!zone.ok) return zone;
  return ok({ name: name.value, country: country.value, timeZone: zone.value });
}

export function checkLocation(
  calendar: TenantCalendar,
  input: PlaceInput & { readonly legalEntityId: string },
): Result<PlaceInput & { readonly legalEntityId: string }> {
  if (!calendar.entities.has(input.legalEntityId)) {
    return err(
      failure('LEGAL_ENTITY_NOT_FOUND', 'No such legal entity in this workspace', ['legalEntityId']),
    );
  }
  const checked = checkLegalEntity(input);
  return checked.ok ? ok({ ...checked.value, legalEntityId: input.legalEntityId }) : checked;
}

/** Tenant-raisable, never lowerable (§6.7, §16.1). */
export const COHORT_FLOOR = 10;

/**
 * A new cohort minimum, against the one in force.
 *
 * Never below the floor, and never below the current setting either: a
 * minimum that could be lowered for an afternoon is a minimum that can be
 * lowered for one query. The database refuses the same thing by trigger.
 */
export function checkCohortMinimum(current: number, next: number): Result<number> {
  if (!Number.isInteger(next) || next < COHORT_FLOOR) {
    return err(
      failure(
        'COHORT_MINIMUM_TOO_LOW',
        `The cohort minimum is a whole number of at least ${String(COHORT_FLOOR)}`,
        ['cohortMinimum'],
      ),
    );
  }
  if (next < current) {
    return err(
      failure(
        'COHORT_MINIMUM_LOWERED',
        `The cohort minimum can be raised, never lowered (it is ${String(current)})`,
        ['cohortMinimum'],
      ),
    );
  }
  return ok(next);
}

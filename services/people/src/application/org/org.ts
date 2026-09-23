import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  err,
  failure,
  localDate,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { CalendarDate, TenantId, type Actor } from '@kithena/contracts';

import {
  checkCohortMinimum,
  checkLegalEntity,
  checkLocation,
  checkTimeZone,
  COHORT_FLOOR,
  effectiveZones,
  locationZoneAt,
  UTC_CALENDAR,
  type LegalEntity,
  type Location,
  type PlaceInput,
  type TenantCalendar,
} from '../../domain/org/calendar.js';
import type { Viewer } from '../person/ports.js';

/**
 * Legal entities, locations and the tenant's People settings (PEO-099).
 *
 * The calendars every "today" in People is read on, and the cohort minimum.
 * Reading is open to anybody in the tenant — an office and its zone are what
 * a colleague's profile shows. Writing is `people_admin`'s, checked here and
 * not in a resolver, so REST and GraphQL refuse the same people.
 */

type Tx = PostgresJsDatabase;

/**
 * The one resolver. Every use case that turns an instant into a calendar day
 * loads the tenant's calendar through this, in its own transaction, and reads
 * whose day it is from `domain/org/calendar.ts`.
 */
export interface Calendars {
  load(tx: Tx, tenantId: string): Promise<TenantCalendar>;
}

/** A tenant with nothing configured: UTC. What a test gets unless it asks for more. */
export const utcCalendars: Calendars = { load: () => Promise.resolve(UTC_CALENDAR) };

/** One fixed calendar for every tenant, for tests. */
export const fixedCalendars = (calendar: TenantCalendar): Calendars => ({
  load: () => Promise.resolve(calendar),
});

export interface TenantSettings {
  readonly defaultTimeZone: string;
  readonly cohortMinimum: number;
  /**
   * `<slug>.app…`, where the company's people sign in, and its name, as the
   * back office last described them (`identity.tenant.*`). Read-only here:
   * the back office owns both. Null until People has heard of them.
   */
  readonly slug: string | null;
  readonly displayName: string | null;
}

export const DEFAULT_SETTINGS: TenantSettings = {
  defaultTimeZone: 'Etc/UTC',
  cohortMinimum: COHORT_FLOOR,
  slug: null,
  displayName: null,
};

/** The company, as an `identity.tenant.*` event described it at `asOf`. */
export interface Company {
  readonly slug: string;
  readonly displayName: string;
  readonly asOf: string;
}

export interface LegalEntityView extends LegalEntity {
  readonly archived: boolean;
}

export interface LocationView {
  readonly id: string;
  readonly legalEntityId: string;
  readonly name: string;
  readonly country: string;
  /** The zone in force now. */
  readonly timeZone: string;
  readonly zones: readonly { readonly effectiveFrom: string; readonly timeZone: string }[];
  readonly archived: boolean;
}

export interface ZoneRow {
  readonly id: string;
  readonly effectiveFrom: CalendarDate;
  readonly timeZone: string;
  readonly supersedes: string | null;
}

/** Every method takes the transaction, for the reason `unit-of-work.ts` gives. */
export interface OrgStore extends Calendars {
  /** The row, or the defaults for a tenant that has none yet. */
  settings(tx: Tx, tenantId: string): Promise<TenantSettings>;
  /** The zone and the minimum; the company copy is `saveCompany`'s. */
  saveSettings(
    tx: Tx,
    tenantId: string,
    settings: Pick<TenantSettings, 'defaultTimeZone' | 'cohortMinimum'>,
  ): Promise<void>;
  /** Keep the company copy, unless the one held is newer. True when it was kept. */
  saveCompany(tx: Tx, tenantId: string, company: Company): Promise<boolean>;
  /** Archived ones included, with the flag. */
  legalEntities(tx: Tx, tenantId: string): Promise<readonly LegalEntityView[]>;
  insertLegalEntity(tx: Tx, tenantId: string, entity: LegalEntity): Promise<void>;
  updateLegalEntity(tx: Tx, tenantId: string, entity: LegalEntityView): Promise<void>;
  locations(
    tx: Tx,
    tenantId: string,
  ): Promise<readonly (Omit<LocationView, 'timeZone' | 'zones'> & { zones: readonly ZoneRow[] })[]>;
  insertLocation(
    tx: Tx,
    tenantId: string,
    location: Omit<Location, 'zones'>,
    zone: ZoneRow,
  ): Promise<void>;
  updateLocation(
    tx: Tx,
    tenantId: string,
    location: { readonly id: string; readonly name: string; readonly archived: boolean },
  ): Promise<void>;
  insertZone(tx: Tx, tenantId: string, locationId: string, zone: ZoneRow): Promise<void>;
  publish(tx: Tx, events: readonly PendingEvent[]): Promise<void>;
}

export interface OrgDeps {
  readonly store: OrgStore;
  readonly clock: Clock;
  /** UUIDv7, for ids and events. */
  readonly newId: () => string;
}

/** Who is asking; `Asking` in person-access is the same shape. */
type Asked<T = object> = {
  readonly tenantId: string;
  readonly viewer: Viewer;
  readonly correlationId: string;
} & T;

/** Who is writing, and what the events say caused it. */
export interface Writer {
  readonly tenantId: string;
  readonly actor: Actor;
  readonly correlationId: string;
  readonly causationId: string | null;
}

const NotAdmin = () =>
  failure('FORBIDDEN', 'Only a People administrator may change legal entities, locations or settings');

export interface OrgAdmin {
  settings(tx: Tx, asking: Asked): Promise<Result<TenantSettings>>;
  updateSettings(
    tx: Tx,
    asking: Asked<{ readonly defaultTimeZone?: string; readonly cohortMinimum?: number }>,
  ): Promise<Result<TenantSettings>>;
  legalEntities(tx: Tx, asking: Asked): Promise<Result<readonly LegalEntityView[]>>;
  createLegalEntity(tx: Tx, asking: Asked<PlaceInput>): Promise<Result<LegalEntityView>>;
  updateLegalEntity(
    tx: Tx,
    asking: Asked<{
      readonly id: string;
      readonly name?: string;
      readonly timeZone?: string;
      readonly archived?: boolean;
    }>,
  ): Promise<Result<LegalEntityView>>;
  locations(tx: Tx, asking: Asked): Promise<Result<readonly LocationView[]>>;
  createLocation(
    tx: Tx,
    asking: Asked<PlaceInput & { readonly legalEntityId: string; readonly effectiveFrom?: string }>,
  ): Promise<Result<LocationView>>;
  updateLocation(
    tx: Tx,
    asking: Asked<{ readonly id: string; readonly name?: string; readonly archived?: boolean }>,
  ): Promise<Result<LocationView>>;
  changeLocationZone(
    tx: Tx,
    asking: Asked<{ readonly id: string; readonly timeZone: string; readonly effectiveFrom: string }>,
  ): Promise<Result<LocationView>>;
  adoptTenant(
    tx: Tx,
    by: Writer,
    tenant: { readonly name: string; readonly country: string; readonly timeZone: string },
  ): Promise<Result<{ readonly created: boolean }>>;
  /** The back office named or renamed the company. An older description is ignored. */
  rememberCompany(tx: Tx, tenantId: string, company: Company): Promise<boolean>;
}

export function orgAdmin(deps: OrgDeps): OrgAdmin {
  const { store } = deps;

  const writer = (asking: Asked): Result<Writer> =>
    asking.viewer.roles.has('people_admin')
      ? ok({
          tenantId: asking.tenantId,
          actor: { kind: 'user', userId: asking.viewer.accountId },
          correlationId: asking.correlationId,
          causationId: null,
        })
      : err(NotAdmin());

  const event = (
    by: Writer,
    name: string,
    aggregate: { type: string; id: string },
    payload: unknown,
    effectiveFrom: CalendarDate | null = null,
  ): PendingEvent => ({
    eventId: deps.newId(),
    eventName: name,
    eventVersion: 1,
    tenantId: TenantId.parse(by.tenantId),
    occurredAt: deps.clock.instant(),
    effectiveFrom,
    aggregate: { ...aggregate, version: 1 },
    actor: by.actor,
    correlationId: by.correlationId,
    causationId: by.causationId,
    payload,
  });

  const viewOf = (
    row: Omit<LocationView, 'timeZone' | 'zones'> & { zones: readonly ZoneRow[] },
  ): LocationView => {
    const zones = effectiveZones(row.zones);
    const place: Location = { ...row, zones };
    return {
      id: row.id,
      legalEntityId: row.legalEntityId,
      name: row.name,
      country: row.country,
      timeZone: locationZoneAt(place, deps.clock.instant()) ?? 'Etc/UTC',
      zones,
      archived: row.archived,
    };
  };

  async function locationView(tx: Tx, tenantId: string, id: string): Promise<Result<LocationView>> {
    const found = (await store.locations(tx, tenantId)).find((l) => l.id === id);
    return found ? ok(viewOf(found)) : err(failure('NOT_FOUND', 'No such location'));
  }

  async function entity(tx: Tx, tenantId: string, id: string): Promise<Result<LegalEntityView>> {
    const found = (await store.legalEntities(tx, tenantId)).find((e) => e.id === id);
    return found ? ok(found) : err(failure('NOT_FOUND', 'No such legal entity'));
  }

  /** The system path as well as the admin's: the consumer creates a tenant's first entity. */
  async function addLegalEntity(
    tx: Tx,
    by: Writer,
    input: PlaceInput,
  ): Promise<Result<LegalEntityView>> {
    const checked = checkLegalEntity(input);
    if (!checked.ok) return checked;
    const created: LegalEntity = { id: deps.newId(), ...checked.value };
    await store.insertLegalEntity(tx, by.tenantId, created);
    await store.publish(tx, [
      event(by, 'people.legal_entity.created', { type: 'LegalEntity', id: created.id }, {
        legalEntityId: created.id,
        name: created.name,
        country: created.country,
        timeZone: created.timeZone,
      }),
    ]);
    return ok({ ...created, archived: false });
  }

  async function writeSettings(
    tx: Tx,
    by: Writer,
    change: { readonly defaultTimeZone?: string; readonly cohortMinimum?: number },
  ): Promise<Result<TenantSettings>> {
    const current = await store.settings(tx, by.tenantId);
    const zone = checkTimeZone(change.defaultTimeZone ?? current.defaultTimeZone, 'defaultTimeZone');
    if (!zone.ok) return zone;
    const minimum = checkCohortMinimum(
      current.cohortMinimum,
      change.cohortMinimum ?? current.cohortMinimum,
    );
    if (!minimum.ok) return minimum;
    const next = { defaultTimeZone: zone.value, cohortMinimum: minimum.value };
    const fieldsChanged = (['defaultTimeZone', 'cohortMinimum'] as const).filter(
      (k) => next[k] !== current[k],
    );
    if (fieldsChanged.length === 0) return ok(current);
    await store.saveSettings(tx, by.tenantId, next);
    await store.publish(tx, [
      event(by, 'people.settings.changed', { type: 'TenantSettings', id: by.tenantId }, {
        ...next,
        fieldsChanged,
      }),
    ]);
    return ok({ ...current, ...next });
  }

  return {
    settings: async (tx: Tx, asking: Asked): Promise<Result<TenantSettings>> =>
      ok(await store.settings(tx, asking.tenantId)),

    updateSettings: async (
      tx: Tx,
      asking: Asked<{ readonly defaultTimeZone?: string; readonly cohortMinimum?: number }>,
    ): Promise<Result<TenantSettings>> => {
      const by = writer(asking);
      return by.ok ? writeSettings(tx, by.value, asking) : by;
    },

    legalEntities: async (tx: Tx, asking: Asked): Promise<Result<readonly LegalEntityView[]>> =>
      ok(await store.legalEntities(tx, asking.tenantId)),

    createLegalEntity: async (tx: Tx, asking: Asked<PlaceInput>): Promise<Result<LegalEntityView>> => {
      const by = writer(asking);
      return by.ok ? addLegalEntity(tx, by.value, asking) : by;
    },

    updateLegalEntity: async (
      tx: Tx,
      asking: Asked<{
        readonly id: string;
        readonly name?: string;
        readonly timeZone?: string;
        readonly archived?: boolean;
      }>,
    ): Promise<Result<LegalEntityView>> => {
      const by = writer(asking);
      if (!by.ok) return by;
      const found = await entity(tx, asking.tenantId, asking.id);
      if (!found.ok) return found;
      const checked = checkLegalEntity({
        name: asking.name ?? found.value.name,
        country: found.value.country,
        timeZone: asking.timeZone ?? found.value.timeZone,
      });
      if (!checked.ok) return checked;
      const next: LegalEntityView = {
        ...found.value,
        name: checked.value.name,
        timeZone: checked.value.timeZone,
        archived: asking.archived ?? found.value.archived,
      };
      const fieldsChanged = (['name', 'timeZone', 'archived'] as const).filter(
        (k) => next[k] !== found.value[k],
      );
      if (fieldsChanged.length === 0) return ok(found.value);
      await store.updateLegalEntity(tx, asking.tenantId, next);
      await store.publish(tx, [
        event(by.value, 'people.legal_entity.updated', { type: 'LegalEntity', id: next.id }, {
          legalEntityId: next.id,
          name: next.name,
          timeZone: next.timeZone,
          archived: next.archived,
          fieldsChanged,
        }),
      ]);
      return ok(next);
    },

    locations: async (tx: Tx, asking: Asked): Promise<Result<readonly LocationView[]>> =>
      ok((await store.locations(tx, asking.tenantId)).map(viewOf)),

    createLocation: async (
      tx: Tx,
      asking: Asked<PlaceInput & { readonly legalEntityId: string; readonly effectiveFrom?: string }>,
    ): Promise<Result<LocationView>> => {
      const by = writer(asking);
      if (!by.ok) return by;
      const checked = checkLocation(await store.load(tx, asking.tenantId), asking);
      if (!checked.ok) return checked;
      const effectiveFrom = dateOr(asking.effectiveFrom, deps.clock, checked.value.timeZone);
      if (!effectiveFrom.ok) return effectiveFrom;
      const { timeZone, ...place } = checked.value;
      const created = { id: deps.newId(), ...place };
      const zone: ZoneRow = {
        id: deps.newId(),
        effectiveFrom: effectiveFrom.value,
        timeZone,
        supersedes: null,
      };
      await store.insertLocation(tx, asking.tenantId, created, zone);
      await store.publish(tx, [
        event(
          by.value,
          'people.location.created',
          { type: 'Location', id: created.id },
          {
            locationId: created.id,
            legalEntityId: created.legalEntityId,
            name: created.name,
            country: created.country,
            timeZone,
            effectiveFrom: zone.effectiveFrom,
          },
          zone.effectiveFrom,
        ),
      ]);
      return locationView(tx, asking.tenantId, created.id);
    },

    updateLocation: async (
      tx: Tx,
      asking: Asked<{ readonly id: string; readonly name?: string; readonly archived?: boolean }>,
    ): Promise<Result<LocationView>> => {
      const by = writer(asking);
      if (!by.ok) return by;
      const found = await locationView(tx, asking.tenantId, asking.id);
      if (!found.ok) return found;
      const name = asking.name?.trim() ?? found.value.name;
      if (name === '' || name.length > 200) {
        return err(failure('NAME_REQUIRED', 'A name of 1 to 200 characters is required', ['name']));
      }
      const next = { id: asking.id, name, archived: asking.archived ?? found.value.archived };
      const fieldsChanged = (['name', 'archived'] as const).filter(
        (k) => next[k] !== found.value[k],
      );
      if (fieldsChanged.length === 0) return found;
      await store.updateLocation(tx, asking.tenantId, next);
      await store.publish(tx, [
        event(by.value, 'people.location.updated', { type: 'Location', id: next.id }, {
          locationId: next.id,
          ...next,
          fieldsChanged,
        }),
      ]);
      return locationView(tx, asking.tenantId, asking.id);
    },

    /**
     * A location's zone from a date. A second change dated the same day is a
     * correction of the first: it supersedes it rather than competing with it.
     */
    changeLocationZone: async (
      tx: Tx,
      asking: Asked<{ readonly id: string; readonly timeZone: string; readonly effectiveFrom: string }>,
    ): Promise<Result<LocationView>> => {
      const by = writer(asking);
      if (!by.ok) return by;
      const zone = checkTimeZone(asking.timeZone);
      if (!zone.ok) return zone;
      const effectiveFrom = dateOr(asking.effectiveFrom, deps.clock, zone.value);
      if (!effectiveFrom.ok) return effectiveFrom;
      const found = (await store.locations(tx, asking.tenantId)).find((l) => l.id === asking.id);
      if (!found) return err(failure('NOT_FOUND', 'No such location'));

      const superseded = new Set(found.zones.map((z) => z.supersedes));
      const sameDay = found.zones.find(
        (z) => !superseded.has(z.id) && z.effectiveFrom === effectiveFrom.value,
      );
      const row: ZoneRow = {
        id: deps.newId(),
        effectiveFrom: effectiveFrom.value,
        timeZone: zone.value,
        supersedes: sameDay?.id ?? null,
      };
      await store.insertZone(tx, asking.tenantId, asking.id, row);
      await store.publish(tx, [
        event(
          by.value,
          'people.location.zone_changed',
          { type: 'Location', id: asking.id },
          {
            locationId: asking.id,
            zoneId: row.id,
            timeZone: row.timeZone,
            effectiveFrom: row.effectiveFrom,
            supersedes: row.supersedes,
          },
          row.effectiveFrom,
        ),
      ]);
      return locationView(tx, asking.tenantId, asking.id);
    },

    /**
     * A new tenant, as the back office created it (`identity.tenant.provisioned`).
     *
     * The default zone, and a first legal entity in the company's country and
     * zone — once. A redelivered event, or a tenant whose admin already made
     * an entity, changes nothing. Not an admin action: the actor is the
     * consumer, and nobody's role is checked.
     */
    adoptTenant: async (
      tx: Tx,
      by: Writer,
      tenant: { readonly name: string; readonly country: string; readonly timeZone: string },
    ): Promise<Result<{ readonly created: boolean }>> => {
      // Checked whole before anything is written: a refused entity must not
      // leave the zone behind, and a Result does not roll a transaction back.
      const checked = checkLegalEntity(tenant);
      if (!checked.ok) return checked;
      if ((await store.legalEntities(tx, by.tenantId)).length > 0) return ok({ created: false });
      const settings = await writeSettings(tx, by, { defaultTimeZone: checked.value.timeZone });
      if (!settings.ok) return settings;
      const created = await addLegalEntity(tx, by, checked.value);
      return created.ok ? ok({ created: true }) : created;
    },

    /*
     * A copy of the back office's facts rather than a People fact, so no
     * People event: `identity.tenant.*` already said it, and a consumer
     * wanting the company's name listens there.
     */
    rememberCompany: (tx, tenantId, company) => store.saveCompany(tx, tenantId, company),
  };
}

/** A calendar date as given, or today on the calendar the change is made in. */
function dateOr(given: string | undefined, clock: Clock, zone: string): Result<CalendarDate> {
  if (given === undefined) return ok(localDate(clock.instant(), zone));
  const parsed = CalendarDate.safeParse(given);
  return parsed.success
    ? ok(parsed.data)
    : err(failure('BAD_REQUEST', 'effectiveFrom is a calendar date, YYYY-MM-DD', ['effectiveFrom']));
}

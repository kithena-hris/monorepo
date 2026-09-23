import { and, asc, eq, sql } from 'drizzle-orm';
import { publish } from '@kithena/db-kit';
import { CalendarDate } from '@kithena/contracts';

import { effectiveZones, type TenantCalendar } from '../domain/org/calendar.js';
import { DEFAULT_SETTINGS, type OrgStore, type ZoneRow } from '../application/org/org.js';
import { legalEntity, location, locationZone, outbox, tenantSettings } from './tables.js';

/** Every location's zone rows, by location. */
async function zonesOf(
  tx: Parameters<OrgStore['load']>[0],
  tenantId: string,
): Promise<Map<string, ZoneRow[]>> {
  const rows = await tx
    .select()
    .from(locationZone)
    .where(eq(locationZone.tenantId, tenantId))
    .orderBy(asc(locationZone.effectiveFrom));
  const byLocation = new Map<string, ZoneRow[]>();
  for (const row of rows) {
    const list = byLocation.get(row.locationId) ?? [];
    list.push({
      id: row.id,
      effectiveFrom: CalendarDate.parse(row.effectiveFrom),
      timeZone: row.timeZone,
      supersedes: row.supersedes,
    });
    byLocation.set(row.locationId, list);
  }
  return byLocation;
}

/**
 * Legal entities, locations and settings in Postgres (PEO-099).
 *
 * `load` is the resolver every "today" in People goes through: four small
 * reads, once per transaction that needs a calendar. A tenant has a handful of
 * entities and at most hundreds of locations, so the whole calendar is read
 * rather than the one row a person points at — and one read answers a
 * snapshot's every entity as cheaply as one profile.
 */
export function drizzleOrgStore(): OrgStore {
  const store: OrgStore = {
    async load(tx, tenantId): Promise<TenantCalendar> {
      const [settings, entities, locations, zones] = [
        await store.settings(tx, tenantId),
        await store.legalEntities(tx, tenantId),
        await tx.select().from(location).where(eq(location.tenantId, tenantId)),
        await zonesOf(tx, tenantId),
      ];
      return {
        defaultZone: settings.defaultTimeZone,
        // Archived ones too: people may still point at them, and their day
        // does not stop being their day because a picker hides the entity.
        entities: new Map(
          entities.map((e) => [
            e.id,
            { id: e.id, name: e.name, country: e.country, timeZone: e.timeZone },
          ]),
        ),
        locations: new Map(
          locations.map((l) => [
            l.id,
            {
              id: l.id,
              legalEntityId: l.legalEntityId,
              name: l.name,
              country: l.country,
              zones: effectiveZones(zones.get(l.id) ?? []),
            },
          ]),
        ),
      };
    },

    async settings(tx, tenantId) {
      const [row] = await tx
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tenantId));
      return row
        ? {
            defaultTimeZone: row.defaultTimeZone,
            cohortMinimum: row.cohortMinimum,
            slug: row.slug,
            displayName: row.displayName,
          }
        : DEFAULT_SETTINGS;
    },

    async saveSettings(tx, tenantId, settings) {
      const set = {
        defaultTimeZone: settings.defaultTimeZone,
        cohortMinimum: settings.cohortMinimum,
      };
      await tx
        .insert(tenantSettings)
        .values({ tenantId, ...set })
        .onConflictDoUpdate({ target: tenantSettings.tenantId, set });
    },

    async saveCompany(tx, tenantId, company) {
      const set = {
        slug: company.slug,
        displayName: company.displayName,
        companyAsOf: new Date(company.asOf),
      };
      // Newer only: a rename delivered late never overwrites a later one.
      const rows = await tx
        .insert(tenantSettings)
        .values({ tenantId, defaultTimeZone: 'Etc/UTC', cohortMinimum: 10, ...set })
        .onConflictDoUpdate({
          target: tenantSettings.tenantId,
          set,
          setWhere: sql`${tenantSettings.companyAsOf} IS NULL OR ${tenantSettings.companyAsOf} < ${company.asOf}::timestamptz`,
        })
        .returning({ tenantId: tenantSettings.tenantId });
      return rows.length > 0;
    },

    async legalEntities(tx, tenantId) {
      const rows = await tx
        .select()
        .from(legalEntity)
        .where(eq(legalEntity.tenantId, tenantId))
        .orderBy(asc(legalEntity.name), asc(legalEntity.id));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        country: r.country,
        timeZone: r.timeZone,
        archived: r.archivedAt !== null,
      }));
    },

    async insertLegalEntity(tx, tenantId, entity) {
      await tx.insert(legalEntity).values({ tenantId, ...entity });
    },

    async updateLegalEntity(tx, tenantId, entity) {
      await tx
        .update(legalEntity)
        .set({
          name: entity.name,
          timeZone: entity.timeZone,
          // Archiving keeps the first instant it happened; un-archiving clears it.
          archivedAt: entity.archived ? sql`COALESCE(${legalEntity.archivedAt}, now())` : null,
        })
        .where(and(eq(legalEntity.tenantId, tenantId), eq(legalEntity.id, entity.id)));
    },

    async locations(tx, tenantId) {
      const [rows, zones] = [
        await tx
          .select()
          .from(location)
          .where(eq(location.tenantId, tenantId))
          .orderBy(asc(location.name), asc(location.id)),
        await zonesOf(tx, tenantId),
      ];
      return rows.map((r) => ({
        id: r.id,
        legalEntityId: r.legalEntityId,
        name: r.name,
        country: r.country,
        archived: r.archivedAt !== null,
        zones: zones.get(r.id) ?? [],
      }));
    },

    async insertLocation(tx, tenantId, place, zone) {
      await tx.insert(location).values({ tenantId, ...place });
      await store.insertZone(tx, tenantId, place.id, zone);
    },

    async updateLocation(tx, tenantId, place) {
      await tx
        .update(location)
        .set({
          name: place.name,
          archivedAt: place.archived ? sql`COALESCE(${location.archivedAt}, now())` : null,
        })
        .where(and(eq(location.tenantId, tenantId), eq(location.id, place.id)));
    },

    async insertZone(tx, tenantId, locationId, zone) {
      await tx.insert(locationZone).values({ tenantId, locationId, ...zone });
    },

    async publish(tx, events) {
      await publish(tx, outbox, events);
    },
  };
  return store;
}

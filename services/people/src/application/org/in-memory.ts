import type { PendingEvent } from '@kithena/domain-kit';

import { effectiveZones, type LegalEntity } from '../../domain/org/calendar.js';
import {
  DEFAULT_SETTINGS,
  type LegalEntityView,
  type OrgStore,
  type TenantSettings,
  type ZoneRow,
} from './org.js';

/** The store, in memory: what the rules are about, without Postgres. */
export function inMemoryOrg(): {
  store: OrgStore;
  events: PendingEvent[];
  settings: () => TenantSettings;
} {
  let settings: TenantSettings = DEFAULT_SETTINGS;
  let companyAsOf: string | null = null;
  const entities = new Map<string, LegalEntityView>();
  const locations = new Map<
    string,
    { id: string; legalEntityId: string; name: string; country: string; archived: boolean; zones: ZoneRow[] }
  >();
  const events: PendingEvent[] = [];

  const store: OrgStore = {
    load: () =>
      Promise.resolve({
        defaultZone: settings.defaultTimeZone,
        entities: new Map([...entities].map(([id, e]) => [id, e as LegalEntity])),
        locations: new Map(
          [...locations].map(([id, l]) => [id, { ...l, zones: effectiveZones(l.zones) }]),
        ),
      }),
    settings: () => Promise.resolve(settings),
    saveSettings: (_tx, _tenant, next) => {
      settings = { ...settings, ...next };
      return Promise.resolve();
    },
    saveCompany: (_tx, _tenant, company) => {
      if (companyAsOf !== null && companyAsOf >= company.asOf) return Promise.resolve(false);
      companyAsOf = company.asOf;
      settings = { ...settings, slug: company.slug, displayName: company.displayName };
      return Promise.resolve(true);
    },
    legalEntities: () => Promise.resolve([...entities.values()]),
    insertLegalEntity: (_tx, _tenant, e) => {
      entities.set(e.id, { ...e, archived: false });
      return Promise.resolve();
    },
    updateLegalEntity: (_tx, _tenant, e) => {
      entities.set(e.id, e);
      return Promise.resolve();
    },
    locations: () => Promise.resolve([...locations.values()]),
    insertLocation: (_tx, _tenant, l, zone) => {
      locations.set(l.id, { ...l, archived: false, zones: [zone] });
      return Promise.resolve();
    },
    updateLocation: (_tx, _tenant, l) => {
      const found = locations.get(l.id);
      if (found) locations.set(l.id, { ...found, name: l.name, archived: l.archived });
      return Promise.resolve();
    },
    insertZone: (_tx, _tenant, id, zone) => {
      locations.get(id)?.zones.push(zone);
      return Promise.resolve();
    },
    publish: (_tx, raised) => {
      events.push(...raised);
      return Promise.resolve();
    },
  };
  return { store, events, settings: () => settings };
}

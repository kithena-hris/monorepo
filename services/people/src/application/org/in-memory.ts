import type { PendingEvent } from '@kithena/domain-kit';

import { effectiveZones, type LegalEntity } from '../../domain/org/calendar.js';
import {
  DEFAULT_SETTINGS,
  type LegalEntityView,
  type OrgStore,
  type TenantSettings,
  type ZoneRow,
} from './org.js';
import type { EmployeeNumbers, NumberingView } from './numbering.js';

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

/** Employee numbering in memory, with `drizzleEmployeeNumbers`'s rule: a change never moves the sequence back. */
export function inMemoryNumbers(): EmployeeNumbers {
  const schemes = new Map<string, NumberingView>();
  return {
    list: () => Promise.resolve([...schemes.values()]),
    scheme: (_tx, _tenant, id) => Promise.resolve(schemes.get(id) ?? null),
    save: (_tx, _tenant, legalEntityId, { prefix, digits, start }) => {
      const nextValue = Math.max(schemes.get(legalEntityId)?.nextValue ?? start, start);
      const saved = { legalEntityId, prefix, digits, nextValue };
      schemes.set(legalEntityId, saved);
      return Promise.resolve(saved);
    },
    allocate: (_tx, _tenant, id) => {
      const found = schemes.get(id);
      if (!found) return Promise.resolve(null);
      schemes.set(id, { ...found, nextValue: found.nextValue + 1 });
      return Promise.resolve({ ...found, sequence: found.nextValue });
    },
    taken: () => Promise.resolve(false),
    observe: (_tx, _tenant, id, sequence) => {
      const found = schemes.get(id);
      if (found && sequence >= found.nextValue) schemes.set(id, { ...found, nextValue: sequence + 1 });
      return Promise.resolve();
    },
  };
}

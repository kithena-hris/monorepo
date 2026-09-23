import { describe, expect, it } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { fixedClock } from '@kithena/domain-kit';

import { inMemoryOrg } from './in-memory.js';
import { orgAdmin } from './org.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const tx = {} as PostgresJsDatabase;

function setup(at = '2026-03-10T12:00:00.000Z') {
  const memory = inMemoryOrg();
  let n = 0;
  const org = orgAdmin({
    store: memory.store,
    clock: fixedClock(at),
    newId: () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
  });
  const as = (roles: string[]) => ({
    tenantId: TENANT,
    viewer: { accountId: '00000000-0000-4000-8000-0000000000a1', roles: new Set(roles) },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  });
  return { ...memory, org, admin: as(['people_admin']), hr: as(['hr']) };
}

describe('who may change the calendar', () => {
  it('refuses anybody but a People administrator, and says so', async () => {
    const { org, hr, events } = setup();
    const refused = await org.createLegalEntity(tx, {
      ...hr,
      name: 'Acme SL',
      country: 'ES',
      timeZone: 'Europe/Madrid',
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(events).toHaveLength(0);
  });

  it('lets anybody in the tenant read them', async () => {
    const { org, hr } = setup();
    expect((await org.legalEntities(tx, hr)).ok).toBe(true);
    expect((await org.settings(tx, hr)).ok).toBe(true);
  });
});

describe('legal entities and locations', () => {
  it('creates an entity and a location under it, each with its event', async () => {
    const { org, admin, events } = setup();
    const entity = await org.createLegalEntity(tx, {
      ...admin,
      name: 'Acme India',
      country: 'in',
      timeZone: 'Asia/Kolkata',
    });
    if (!entity.ok) throw new Error(entity.error.message);
    expect(entity.value).toMatchObject({ country: 'IN', timeZone: 'Asia/Kolkata', archived: false });

    const office = await org.createLocation(tx, {
      ...admin,
      legalEntityId: entity.value.id,
      name: 'Bangalore',
      country: 'IN',
      timeZone: 'Asia/Kolkata',
    });
    if (!office.ok) throw new Error(office.error.message);
    // Created today on its own calendar: 12:00 UTC is 17:30 in Kolkata, still the 10th.
    expect(office.value.zones).toEqual([{ effectiveFrom: '2026-03-10', timeZone: 'Asia/Kolkata' }]);
    expect(events.map((e) => e.eventName)).toEqual([
      'people.legal_entity.created',
      'people.location.created',
    ]);
    expect(events[1]?.effectiveFrom).toBe('2026-03-10');
  });

  it('refuses a zone the runtime does not know', async () => {
    const { org, admin } = setup();
    expect(
      await org.createLegalEntity(tx, { ...admin, name: 'Acme', country: 'ES', timeZone: 'CET+1' }),
    ).toMatchObject({ ok: false, error: { code: 'TIME_ZONE_UNKNOWN' } });
  });

  it("changes a location's zone from a date, and treats a second change that day as a correction", async () => {
    const { org, admin, events } = setup();
    const entity = await org.createLegalEntity(tx, {
      ...admin,
      name: 'Acme SL',
      country: 'ES',
      timeZone: 'Europe/Madrid',
    });
    if (!entity.ok) throw new Error('no entity');
    const office = await org.createLocation(tx, {
      ...admin,
      legalEntityId: entity.value.id,
      name: 'Las Palmas',
      country: 'ES',
      timeZone: 'Europe/Madrid',
      effectiveFrom: '2020-01-01',
    });
    if (!office.ok) throw new Error('no office');

    await org.changeLocationZone(tx, {
      ...admin,
      id: office.value.id,
      timeZone: 'Europe/Lisbon',
      effectiveFrom: '2026-04-01',
    });
    const corrected = await org.changeLocationZone(tx, {
      ...admin,
      id: office.value.id,
      timeZone: 'Atlantic/Canary',
      effectiveFrom: '2026-04-01',
    });
    if (!corrected.ok) throw new Error(corrected.error.message);

    expect(corrected.value.zones).toEqual([
      { effectiveFrom: '2020-01-01', timeZone: 'Europe/Madrid' },
      { effectiveFrom: '2026-04-01', timeZone: 'Atlantic/Canary' },
    ]);
    // In force today (10 March) is still Madrid.
    expect(corrected.value.timeZone).toBe('Europe/Madrid');
    const changes = events.filter((e) => e.eventName === 'people.location.zone_changed');
    const [first, second] = changes.map((e) => e.payload as { zoneId: string; supersedes: string | null });
    expect(first?.supersedes).toBeNull();
    expect(second?.supersedes).toBe(first?.zoneId);
  });
});

describe('settings', () => {
  it('raises the cohort minimum and never lowers it', async () => {
    const { org, admin } = setup();
    expect(await org.updateSettings(tx, { ...admin, cohortMinimum: 15 })).toMatchObject({
      ok: true,
      value: { cohortMinimum: 15 },
    });
    expect(await org.updateSettings(tx, { ...admin, cohortMinimum: 12 })).toMatchObject({
      ok: false,
      error: { code: 'COHORT_MINIMUM_LOWERED' },
    });
  });

  it('writes nothing, and raises nothing, when nothing changed', async () => {
    const { org, admin, events } = setup();
    await org.updateSettings(tx, { ...admin, cohortMinimum: 10 });
    expect(events).toHaveLength(0);
  });
});

describe('a tenant the back office just created', () => {
  const by = {
    tenantId: TENANT,
    actor: { kind: 'system', process: 'people.consumer' } as const,
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: '01900000-0000-7000-8000-00000000ffff',
  };

  it('takes the default zone and a first legal entity, once', async () => {
    const { org, events, settings } = setup();
    const tenant = { name: 'Acme', country: 'NZ', timeZone: 'Pacific/Auckland' };
    // NZ is not an address country yet; the entity is refused and the zone is not kept.
    expect((await org.adoptTenant(tx, by, tenant)).ok).toBe(false);

    const madrid = { name: 'Acme', country: 'ES', timeZone: 'Europe/Madrid' };
    expect(await org.adoptTenant(tx, by, madrid)).toEqual({ ok: true, value: { created: true } });
    expect(await org.adoptTenant(tx, by, madrid)).toEqual({ ok: true, value: { created: false } });
    expect(settings().defaultTimeZone).toBe('Europe/Madrid');
    expect(events.filter((e) => e.eventName === 'people.legal_entity.created')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import type { CalendarDate } from '@kithena/contracts';

import {
  COHORT_FLOOR,
  checkCohortMinimum,
  checkLegalEntity,
  checkLocation,
  checkTimeZone,
  effectiveZones,
  entityDays,
  entityZone,
  locationZoneAt,
  personZone,
  UTC_CALENDAR,
  type TenantCalendar,
} from './calendar.js';

/**
 * Whose day it is.
 *
 * Every "today" in People is an instant read on somebody's calendar, and the
 * calendar is a legal entity's or a location's, never UTC's and never one
 * zone for a whole tenant. The rule for a person: their work location's zone,
 * else their legal entity's default, else their own zone, else the tenant's.
 */

const day = (d: string) => d as CalendarDate;

const MADRID = 'e0000000-0000-4000-8000-000000000001';
const BANGALORE = 'e0000000-0000-4000-8000-000000000002';
const CANARIES = 'a0000000-0000-4000-8000-000000000001';
const PUNE = 'a0000000-0000-4000-8000-000000000002';

const calendar: TenantCalendar = {
  defaultZone: 'Europe/Madrid',
  entities: new Map([
    [MADRID, { id: MADRID, name: 'Acme SL', country: 'ES', timeZone: 'Europe/Madrid' }],
    [BANGALORE, { id: BANGALORE, name: 'Acme India', country: 'IN', timeZone: 'Asia/Kolkata' }],
  ]),
  locations: new Map([
    [
      CANARIES,
      {
        id: CANARIES,
        legalEntityId: MADRID,
        name: 'Las Palmas',
        country: 'ES',
        zones: [{ effectiveFrom: day('2020-01-01'), timeZone: 'Atlantic/Canary' }],
      },
    ],
    [
      PUNE,
      {
        id: PUNE,
        legalEntityId: BANGALORE,
        name: 'Pune',
        country: 'IN',
        zones: [{ effectiveFrom: day('2020-01-01'), timeZone: 'Asia/Kolkata' }],
      },
    ],
  ]),
};

describe("a person's zone", () => {
  const at = '2026-03-01T12:00:00.000Z';

  it("is the work location's zone first", () => {
    expect(
      personZone(calendar, { locationId: CANARIES, legalEntityId: MADRID, ownZone: 'Asia/Tokyo' }, at),
    ).toBe('Atlantic/Canary');
  });

  it("falls back to the legal entity's default", () => {
    expect(
      personZone(calendar, { locationId: null, legalEntityId: BANGALORE, ownZone: 'Asia/Tokyo' }, at),
    ).toBe('Asia/Kolkata');
  });

  it("falls back to the person's own zone when there is no entity", () => {
    expect(
      personZone(calendar, { locationId: null, legalEntityId: null, ownZone: 'Asia/Tokyo' }, at),
    ).toBe('Asia/Tokyo');
  });

  it("falls back to the tenant's default last", () => {
    expect(personZone(calendar, { locationId: null, legalEntityId: null, ownZone: null }, at)).toBe(
      'Europe/Madrid',
    );
  });

  it('skips a location or entity the tenant does not have, and an own zone that is not one', () => {
    expect(
      personZone(
        calendar,
        { locationId: 'nowhere', legalEntityId: 'nobody', ownZone: 'Europe/Atlantis' },
        at,
      ),
    ).toBe('Europe/Madrid');
  });

  it('is UTC for a tenant nobody has configured', () => {
    expect(personZone(UTC_CALENDAR, { locationId: null, legalEntityId: null, ownZone: null }, at)).toBe(
      'Etc/UTC',
    );
  });
});

describe("a location's zone is effective-dated", () => {
  const moving = {
    id: 'loc',
    legalEntityId: MADRID,
    name: 'Office that moves',
    country: 'ES',
    zones: [
      { effectiveFrom: day('2020-01-01'), timeZone: 'Europe/Madrid' },
      { effectiveFrom: day('2026-04-01'), timeZone: 'Atlantic/Canary' },
    ],
  };

  it('uses the zone in force before the change', () => {
    expect(locationZoneAt(moving, '2026-03-31T12:00:00.000Z')).toBe('Europe/Madrid');
  });

  it('turns over at midnight on the effective day, in the new zone', () => {
    // Midnight on 1 April in the Canaries (WEST, UTC+1) is 23:00 UTC on the 31st.
    expect(locationZoneAt(moving, '2026-03-31T22:59:59.000Z')).toBe('Europe/Madrid');
    expect(locationZoneAt(moving, '2026-03-31T23:00:00.000Z')).toBe('Atlantic/Canary');
  });

  it('uses the earliest zone for an instant before any of them', () => {
    expect(locationZoneAt(moving, '2019-06-01T12:00:00.000Z')).toBe('Europe/Madrid');
  });

  it('lets a correction replace the row it supersedes', () => {
    const zones = effectiveZones([
      { id: 'z1', effectiveFrom: day('2020-01-01'), timeZone: 'Europe/Lisbon', supersedes: null },
      { id: 'z2', effectiveFrom: day('2020-01-01'), timeZone: 'Europe/Madrid', supersedes: 'z1' },
      { id: 'z3', effectiveFrom: day('2026-04-01'), timeZone: 'Atlantic/Canary', supersedes: null },
    ]);
    expect(zones).toEqual([
      { effectiveFrom: '2020-01-01', timeZone: 'Europe/Madrid' },
      { effectiveFrom: '2026-04-01', timeZone: 'Atlantic/Canary' },
    ]);
  });
});

describe('a tenant with entities in Madrid and Bangalore', () => {
  it("counts each entity on its own day: 20:00 UTC on the 31st is the 1st in Bangalore", () => {
    const days = entityDays(calendar, '2026-03-31T20:00:00.000Z');
    expect(days.byEntity.get(MADRID)).toBe('2026-03-31');
    expect(days.byEntity.get(BANGALORE)).toBe('2026-04-01');
    // Somebody with no entity is counted on the tenant's day.
    expect(days.fallback).toBe('2026-03-31');
  });

  it("uses an entity's own default, never its locations'", () => {
    // 23:30 UTC on 28 March: the 29th in Madrid (UTC+1), still the 28th in the Canaries (UTC+0).
    expect(entityDays(calendar, '2026-03-28T23:30:00.000Z').byEntity.get(MADRID)).toBe('2026-03-29');
    expect(entityZone(calendar, MADRID)).toBe('Europe/Madrid');
    expect(entityZone(calendar, null)).toBe('Europe/Madrid');
  });
});

describe('checking what an admin sends', () => {
  it('refuses a zone that is not an IANA zone', () => {
    expect(checkTimeZone('UTC+5:30').ok).toBe(false);
    expect(checkTimeZone('Asia/Kolkata').ok).toBe(true);
  });

  it('refuses a legal entity without a name, a supported country or a real zone', () => {
    expect(checkLegalEntity({ name: '  ', country: 'ES', timeZone: 'Europe/Madrid' }).ok).toBe(false);
    expect(checkLegalEntity({ name: 'Acme', country: 'XX', timeZone: 'Europe/Madrid' }).ok).toBe(false);
    expect(checkLegalEntity({ name: 'Acme', country: 'es', timeZone: 'Europe/Nowhere' }).ok).toBe(false);
    const ok = checkLegalEntity({ name: ' Acme SL ', country: 'es', timeZone: 'Europe/Madrid' });
    expect(ok).toEqual({
      ok: true,
      value: { name: 'Acme SL', country: 'ES', timeZone: 'Europe/Madrid' },
    });
  });

  it('refuses a location under a legal entity the tenant does not have', () => {
    const input = { name: 'Pune', country: 'IN', timeZone: 'Asia/Kolkata', legalEntityId: 'nobody' };
    expect(checkLocation(calendar, input)).toMatchObject({
      ok: false,
      error: { code: 'LEGAL_ENTITY_NOT_FOUND' },
    });
    expect(checkLocation(calendar, { ...input, legalEntityId: BANGALORE }).ok).toBe(true);
  });
});

describe('the cohort minimum', () => {
  it('defaults to, and never goes below, ten', () => {
    expect(COHORT_FLOOR).toBe(10);
    expect(checkCohortMinimum(COHORT_FLOOR, 9)).toMatchObject({ ok: false });
  });

  it('may be raised', () => {
    expect(checkCohortMinimum(10, 25)).toEqual({ ok: true, value: 25 });
  });

  it('may never be lowered, even to a value above the floor', () => {
    expect(checkCohortMinimum(25, 20)).toMatchObject({
      ok: false,
      error: { code: 'COHORT_MINIMUM_LOWERED' },
    });
    expect(checkCohortMinimum(25, 25)).toEqual({ ok: true, value: 25 });
  });

  it('is a whole number', () => {
    expect(checkCohortMinimum(10, 12.5).ok).toBe(false);
  });
});

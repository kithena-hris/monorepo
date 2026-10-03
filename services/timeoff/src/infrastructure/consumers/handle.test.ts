import { describe, expect, it } from 'vitest';
import {
  LocationCreated,
  LocationZoneChanged,
  PersonHired,
  PersonManagerChanged,
  PersonOrgChanged,
  PersonStatusChanged,
  PersonSyncedFromExternal,
  PersonTerminated,
  type DefinedEvent,
} from '@kithena/contracts';

import { people, TENANT, world } from '../../application/testing/world.js';
import { locationKeyOf, teamKeyOf, timeoffConsumer } from './handle.js';

/**
 * TOF-045's "done when": People's events applied out of order, and twice,
 * end in the state their effective dates say.
 */

const ADAM = people.adam;
const ORG = '0c0c0c0c-0000-4000-8000-000000000001';
const MADRID_OFFICE = '1d1d1d1d-0000-4000-8000-000000000001';

/** UUIDv7 ids in the order given: `id(1)` is older than `id(2)`. */
const id = (n: number): string => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function envelope(
  event: DefinedEvent,
  n: number,
  effectiveFrom: string,
  payload: Record<string, unknown>,
): unknown {
  return {
    eventId: id(n),
    eventName: event.name,
    eventVersion: event.version,
    tenantId: TENANT,
    occurredAt: '2026-10-01T08:00:00.000Z',
    recordedAt: '2026-10-01T08:00:00.000Z',
    effectiveFrom,
    aggregate: { type: 'Person', id: ADAM, version: n },
    actor: { kind: 'system', process: 'people' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
    payload,
  };
}

const hired = envelope(PersonHired, 1, '2024-03-04', {
  personId: ADAM,
  identityAccountId: null,
  legalEntityId: null,
  name: { given: 'Adam', family: 'Novak', preferred: null },
  workEmail: 'adam.novak@acme.example',
  employment: { from: '2024-03-04', to: null },
  status: 'active',
  managerId: people.marco,
  orgUnitId: ORG,
  schemaVersion: 1,
  sourceOfRecord: 'own',
});
const managerChanged = (n: number, effectiveFrom: string, managerId: string) =>
  envelope(PersonManagerChanged, n, effectiveFrom, {
    personId: ADAM,
    previousManagerId: people.marco,
    managerId,
  });

describe('the People consumer', () => {
  it('applies events out of order and twice, and ends where their dates say', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { members: false });
    const handle = timeoffConsumer(app.deps);
    const s = app.state(TENANT);

    expect(await handle(hired)).toBe('applied');
    expect(s.ledger.filter((e) => e.personId === ADAM).map((e) => e.kind)).toEqual(['grant']);

    // Omar from June, then a correction dated March arriving after it.
    expect(await handle(managerChanged(3, '2026-06-01', people.omar))).toBe('applied');
    expect(await handle(managerChanged(2, '2026-03-01', people.leo))).toBe('unchanged');
    // Redelivered, both of them.
    expect(await handle(managerChanged(3, '2026-06-01', people.omar))).toBe('unchanged');
    expect(await handle(hired)).toBe('unchanged');
    expect(s.ledger.filter((e) => e.personId === ADAM)).toHaveLength(1);

    // The office exists before anyone moves there; then its zone changes.
    expect(
      await handle(
        envelope(LocationCreated, 4, '2026-01-01', {
          locationId: MADRID_OFFICE,
          legalEntityId: '2e2e2e2e-0000-4000-8000-000000000001',
          name: 'Madrid office',
          country: 'ES',
          timeZone: 'Europe/Madrid',
          effectiveFrom: '2026-01-01',
        }),
      ),
    ).toBe('applied');
    expect(
      await handle(
        envelope(PersonOrgChanged, 5, '2026-07-01', {
          personId: ADAM,
          orgUnitId: ORG,
          costCentre: null,
          legalEntityId: null,
          locationId: MADRID_OFFICE,
        }),
      ),
    ).toBe('applied');
    expect(
      await handle(
        envelope(LocationZoneChanged, 6, '2026-09-01', {
          locationId: MADRID_OFFICE,
          zoneId: '3f3f3f3f-0000-4000-8000-000000000001',
          timeZone: 'Atlantic/Canary',
          effectiveFrom: '2026-09-01',
          supersedes: null,
        }),
      ),
    ).toBe('applied');

    // Leaving at the end of the year; notice is still a member.
    expect(
      await handle(
        envelope(PersonStatusChanged, 7, '2026-09-15', {
          personId: ADAM,
          previous: 'active',
          next: 'notice',
          reason: 'resigned',
        }),
      ),
    ).toBe('applied');
    expect(
      await handle(
        envelope(PersonTerminated, 8, '2026-09-15', {
          personId: ADAM,
          lastWorkingDay: '2026-12-31',
          reason: null,
          eligibleForRehire: null,
        }),
      ),
    ).toBe('applied');

    expect(s.members.get(ADAM)).toEqual({
      personId: ADAM,
      displayName: 'Adam Novak',
      firstName: 'Adam',
      managerPersonId: people.omar,
      teamKey: teamKeyOf(ORG),
      teamName: null,
      locationKey: locationKeyOf(MADRID_OFFICE),
      country: 'ES',
      region: null,
      city: null,
      // The zone change reached him without holding back his own events.
      timeZone: 'Atlantic/Canary',
      hireDate: '2024-03-04',
      terminationDate: '2026-12-31',
      workPattern: null,
      status: 'active',
      lastEventId: id(8),
      lastEffectiveFrom: '2026-09-15',
    });
  });

  it('ignores events about somebody it does not know, and what it does not read', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { members: false });
    const handle = timeoffConsumer(app.deps);
    expect(await handle(managerChanged(2, '2026-06-01', people.omar))).toBe('ignored');
    expect(
      await handle(
        envelope(PersonSyncedFromExternal, 3, '2026-06-01', {
          personId: ADAM,
          provider: 'workday',
          externalId: 'W-1',
          fieldsChanged: ['manager'],
        }),
      ),
    ).toBe('ignored');
    expect(await handle({ eventName: 'people.person.job_changed' })).toBe('ignored');
    expect(app.state(TENANT).members.size).toBe(0);
  });

  it('rejects a malformed event without throwing, so the partition moves on', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { members: false });
    const handle = timeoffConsumer(app.deps);
    expect(await handle({ eventName: PersonHired.name, payload: {} })).toBe('rejected');
  });
});

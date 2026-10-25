import { randomUUID } from 'node:crypto';
import { CalendarDate, Instant, TenantId } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import type { Deps } from '../../application/ports.js';
import { generateContract, sendForSignature } from '../../domain/contract/contract.js';
import { memoryBlobs, memoryUnitOfWork } from '../../testing/memory.js';
import { recruitingConsumer } from './handle.js';

/**
 * Documents' `envelope.completed` reaching Recruiting (REC-140): matched on
 * the subject reference, applied as the system, and harmless when it is not
 * Recruiting's or the contract is not waiting for it.
 */

const tenantId = TenantId.parse(randomUUID());
const at = '2026-10-19T09:00:00.000Z';
const clock: Clock = {
  now: () => new Date(at),
  today: () => at.slice(0, 10),
  instant: () => Instant.parse(at),
  date: () => CalendarDate.parse(at.slice(0, 10)),
};

function completed(subjectRef: string | null): Record<string, unknown> {
  return {
    eventId: '01890000-0000-7000-8000-000000000000',
    eventName: 'documents.envelope.completed',
    eventVersion: 1,
    tenantId,
    occurredAt: at,
    recordedAt: at,
    effectiveFrom: at.slice(0, 10),
    aggregate: { type: 'Envelope', id: randomUUID(), version: 1 },
    actor: { kind: 'system', process: 'documents' },
    correlationId: randomUUID(),
    causationId: null,
    payload: {
      envelopeId: randomUUID(),
      documentId: randomUUID(),
      signedVersion: 2,
      subjectPersonId: null,
      subjectRef,
    },
  };
}

const terms = {
  country: 'ES',
  region: null,
  packVersion: 'es-2026.1',
  relationship: 'employee',
  contractType: 'indefinido',
  employmentType: 'permanent',
  fixedTermReason: null,
  contractStart: '2026-11-02',
  contractEnd: null,
  workingPattern: 'full_time',
  weeklyMinutes: 2400,
  fte: '1.0000',
  probation: { count: 6, unit: 'months' },
  probationEnd: '2027-05-02',
  noticeEmployee: { count: 15, unit: 'days' },
  noticeEmployer: { count: 15, unit: 'days' },
  workMode: 'onsite',
  hybridDaysOnsite: null,
  remoteCountry: null,
  collectiveAgreement: null,
  nonCompeteMonths: null,
  mobilityClause: false,
  paymentsPerYear: 14,
  signature: 'electronic',
  documents: ['contract'],
  conditions: [],
} as const;

describe('a signed envelope from Documents', () => {
  it('is ignored unless it carries a reference of Recruiting’s', async () => {
    const uow = memoryUnitOfWork();
    const deps: Deps = {
      uow,
      blobs: memoryBlobs(),
      clock,
      newId: randomUUID,
      jobsOrigin: 'https://jobs.example',
      extractText: () => Promise.resolve(''),
    };
    const consume = recruitingConsumer(uow, deps);
    expect(await consume(completed(null))).toBe('ignored');
    expect(await consume(completed('people:letter:abc'))).toBe('ignored');
    expect(await consume(completed('recruiting:offer:nobody:1'))).toBe('applied');
    // Published before Documents named itself the actor: an outside signer or the seal as a user.
    for (const userId of ['signer', 'system'])
      expect(
        await consume({
          ...completed('recruiting:offer:nobody:1'),
          actor: { kind: 'user', userId },
        }),
      ).toBe('applied');
  });

  it('changes nothing for a contract that was never sent, and is not applied without the use cases', async () => {
    const uow = memoryUnitOfWork();
    const deps: Deps = {
      uow,
      blobs: memoryBlobs(),
      clock,
      newId: randomUUID,
      jobsOrigin: 'https://jobs.example',
      extractText: () => Promise.resolve(''),
    };
    const offerId = randomUUID();
    const generated = generateContract(randomUUID(), offerId, 1, terms as never, true);
    await uow.run(tenantId, (tx) => tx.contracts.save({ ...generated, fileId: null }));
    const consume = recruitingConsumer(uow, deps);
    expect(await consume(completed(generated.subjectRef))).toBe('unchanged');
    expect(await recruitingConsumer(uow)(completed(generated.subjectRef))).toBe('ignored');
    // Sent, the same event is Recruiting's to act on; with no offer behind it, it is refused and said so.
    const sent = sendForSignature(generated);
    if (!sent.ok) throw new Error(sent.error.code);
    await uow.run(tenantId, (tx) => tx.contracts.save({ ...sent.value, fileId: null }));
    expect(await consume(completed(generated.subjectRef))).toBe('rejected');
  });
});

/** People's organisation reaching Recruiting (PRD §5.2): shown as People's, tied to, never edited here. */
function orgEvent(eventName: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    eventId: '01890000-0000-7000-8000-000000000001',
    eventName,
    eventVersion: 1,
    tenantId,
    occurredAt: at,
    recordedAt: at,
    effectiveFrom: at.slice(0, 10),
    aggregate: { type: 'Organisation', id: randomUUID(), version: 1 },
    actor: { kind: 'system', process: 'people' },
    correlationId: randomUUID(),
    causationId: null,
    payload,
  };
}

describe('People’s legal entities, locations and org units', () => {
  it('become Recruiting’s, marked as People’s, with the pack’s currency and statutory benefits', async () => {
    const uow = memoryUnitOfWork();
    const consume = recruitingConsumer(uow);
    const legalEntityId = randomUUID();
    const locationId = randomUUID();
    const orgUnitId = randomUUID();
    expect(
      await consume(
        orgEvent('people.legal_entity.created', {
          legalEntityId,
          name: 'Acme Ltd',
          country: 'GB',
          timeZone: 'Europe/London',
        }),
      ),
    ).toBe('applied');
    expect(
      await consume(
        orgEvent('people.location.created', {
          locationId,
          legalEntityId,
          name: 'London',
          country: 'GB',
          timeZone: 'Europe/London',
          effectiveFrom: '2026-01-01',
        }),
      ),
    ).toBe('applied');
    expect(
      await consume(
        orgEvent('people.org_unit.created', { orgUnitId, name: 'Engineering', parentId: null }),
      ),
    ).toBe('applied');
    const held = await uow.run(tenantId, async (tx) => ({
      entity: await tx.entities.get(legalEntityId),
      location: await tx.locations.get(locationId),
      unit: await tx.orgUnits.get(orgUnitId),
      statutory: (await tx.benefits.list()).filter((b) => b.legalEntityId === legalEntityId),
    }));
    expect(held.entity).toMatchObject({
      name: 'Acme Ltd',
      country: 'GB',
      currency: 'GBP',
      source: 'people',
    });
    expect(held.location).toMatchObject({
      name: 'London',
      entityId: legalEntityId,
      source: 'people',
    });
    expect(held.unit).toMatchObject({ name: 'Engineering', parentId: null, source: 'people' });
    expect(held.statutory.length).toBeGreaterThan(0);
    // Said again: nothing moves.
    expect(
      await consume(
        orgEvent('people.org_unit.created', { orgUnitId, name: 'Engineering', parentId: null }),
      ),
    ).toBe('unchanged');
    // Archived in People: gone here.
    expect(
      await consume(
        orgEvent('people.org_unit.updated', {
          orgUnitId,
          name: 'Engineering',
          parentId: null,
          archived: true,
          fieldsChanged: ['archived'],
        }),
      ),
    ).toBe('applied');
    expect(await uow.run(tenantId, (tx) => tx.orgUnits.get(orgUnitId))).toBeNull();
  });

  it('ignores an entity in a country Recruiting cannot hire in', async () => {
    const uow = memoryUnitOfWork();
    const consume = recruitingConsumer(uow);
    expect(
      await consume(
        orgEvent('people.legal_entity.created', {
          legalEntityId: randomUUID(),
          name: 'Acme SAS',
          country: 'FR',
          timeZone: 'Europe/Paris',
        }),
      ),
    ).toBe('ignored');
  });
});

describe('the company’s host, from identity', () => {
  const tenant = (name: string, slug: string, occurredAt: string) => ({
    eventId: '01890000-0000-7000-8000-000000000001',
    eventName: name,
    eventVersion: 1,
    tenantId,
    occurredAt,
    recordedAt: occurredAt,
    effectiveFrom: occurredAt.slice(0, 10),
    aggregate: { type: 'Tenant', id: tenantId, version: 1 },
    actor: { kind: 'system', process: 'identity' },
    correlationId: randomUUID(),
    causationId: null,
    payload:
      name === 'identity.tenant.provisioned'
        ? { slug, displayName: 'Acme', country: 'ES', timeZone: 'Europe/Madrid' }
        : { slug, displayName: 'Acme' },
  });

  it('keeps the newest slug, whatever order they arrive in', async () => {
    const uow = memoryUnitOfWork();
    const handle = recruitingConsumer(uow);
    expect(
      await handle(tenant('identity.tenant.amended', 'acme-two', '2026-10-02T00:00:00.000Z')),
    ).toBe('applied');
    expect(
      await handle(tenant('identity.tenant.provisioned', 'acme', '2026-10-01T00:00:00.000Z')),
    ).toBe('unchanged');
    expect(await uow.run(tenantId, (tx) => tx.settings.get('host'))).toMatchObject({
      slug: 'acme-two',
    });
  });
});

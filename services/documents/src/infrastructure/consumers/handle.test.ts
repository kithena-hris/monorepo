import { TenantId } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { memoryWorld } from '../../testing/memory.js';
import { documentsConsumer } from './handle.js';

const TENANT = TenantId.parse('00000000-0000-4000-8000-0000000000a1');
const PERSON = '00000000-0000-4000-8000-0000000000b1';

const hired = (email: string) => ({
  eventId: '01890000-0000-7000-8000-000000000001',
  eventName: 'people.person.hired',
  eventVersion: 1,
  tenantId: TENANT,
  occurredAt: '2026-10-25T00:00:00.000Z',
  recordedAt: '2026-10-25T00:00:00.000Z',
  effectiveFrom: '2026-12-01',
  aggregate: { type: 'Person', id: PERSON, version: 1 },
  actor: { kind: 'system', process: 'test' },
  correlationId: '00000000-0000-4000-8000-000000000002',
  causationId: null,
  payload: {
    personId: PERSON,
    identityAccountId: null,
    name: { given: 'Yuki', family: 'Sato', preferred: null },
    workEmail: email,
    managerId: null,
    orgUnitId: null,
    legalEntityId: null,
    employment: { from: '2026-12-01', to: null },
    status: 'pending',
    schemaVersion: 1,
    sourceOfRecord: 'own',
  },
});

describe('a hire from Recruiting', () => {
  it('gets the contract they signed as a candidate, filed about them', async () => {
    const world = memoryWorld();
    const doc = (id: string) => ({ id, subjectPersonId: null }) as never;
    const env = (id: string, documentId: string, subjectRef: string | null) =>
      ({
        id,
        documentId,
        status: 'completed',
        subjectRef,
        signers: [{ email: 'Yuki@Example.com', personId: null }],
      }) as never;
    await world.uow.run(TENANT, async (tx) => {
      await tx.documents.save(doc('d-contract'));
      await tx.documents.save(doc('d-other'));
      await tx.envelopes.save(env('e1', 'd-contract', 'recruiting:offer:o1:1'));
      await tx.envelopes.save(env('e2', 'd-other', null));
    });
    expect(await documentsConsumer(world.uow)(hired('yuki@example.com'))).toBe('applied');
    const subject = (id: string) =>
      world.uow.run(TENANT, async (tx) => (await tx.documents.get(id as never))?.subjectPersonId);
    expect(await subject('d-contract')).toBe(PERSON);
    // The event again, as a replay reads it: nothing left to file.
    expect(await documentsConsumer(world.uow)(hired('yuki@example.com'))).toBe('unchanged');
    // A document another module did not send for a hire stays as it was.
    expect(await subject('d-other')).toBeNull();
  });
});

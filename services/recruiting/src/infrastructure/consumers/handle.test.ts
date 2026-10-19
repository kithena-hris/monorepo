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

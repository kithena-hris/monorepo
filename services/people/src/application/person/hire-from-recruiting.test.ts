import { describe, expect, it } from 'vitest';

import { attributesOf, hiresFromRecruiting } from './hire-from-recruiting.js';
import { define, inMemoryPeople, noTransaction as tx, TENANT, versionOf } from './in-memory.js';
import { personAccess } from './person-access.js';
import { SYSTEM_VIEWER, withSupport } from './subject.js';

/**
 * A hire Recruiting made, as People's own pre-hire (PRD §21.4, REC-141):
 * created once from the event, found and discarded by its work email when
 * the hire falls through.
 */

const hired = {
  eventId: '01890000-0000-7000-8000-000000000001',
  eventName: 'recruiting.candidate.hired',
  eventVersion: 1,
  tenantId: TENANT,
  occurredAt: '2026-10-19T09:00:00.000Z',
  recordedAt: '2026-10-19T09:00:00.000Z',
  effectiveFrom: '2026-11-02',
  aggregate: { type: 'Application', id: 'app-1', version: 1 },
  actor: { kind: 'system', process: 'recruiting' },
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  causationId: null,
  payload: {
    candidateId: '00000000-0000-4000-8000-0000000000d1',
    applicationId: '00000000-0000-4000-8000-0000000000d2',
    jobId: '00000000-0000-4000-8000-0000000000d3',
    offerId: '00000000-0000-4000-8000-0000000000d4',
    offerVersion: 1,
    candidate: { givenName: 'Yuki', familyName: 'Tanaka', email: 'Yuki@Example.com', phone: null },
    terms: {
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
    },
    pay: { base: { amountMinor: 4_200_000, currency: 'EUR' }, frequency: 'year' },
    benefits: [],
    startDate: '2026-11-02',
    managerId: null,
    orgUnitId: null,
    locationId: null,
    legalEntityId: '00000000-0000-4000-8000-0000000000e1',
    conditions: [],
  },
} as const;

const cancelled = {
  ...hired,
  eventId: '01890000-0000-7000-8000-000000000002',
  eventName: 'recruiting.prehire.cancelled',
  payload: {
    candidateId: hired.payload.candidateId,
    applicationId: hired.payload.applicationId,
    reasonKey: 'reneged',
    email: 'yuki@example.com',
  },
} as const;

const email = define({
  key: 'work_email',
  visibility: ['self', 'manager', 'hr', 'directory'],
  ownership: ['hr'],
});
const probation = define({ key: 'probation_end', dataType: 'date', typeConfig: { kind: 'date' } });
const retired = define({ key: 'employment_type', deprecatedAt: '2026-01-01T00:00:00.000Z' });

function setup() {
  const store = inMemoryPeople([
    versionOf(1, [
      define({ key: 'given_name' }),
      define({ key: 'family_name' }),
      email,
      probation,
      retired,
    ]),
  ]);
  const access = personAccess({ ...store.deps, relations: withSupport(store.deps.relations) });
  return { store, hires: hiresFromRecruiting(access, store.deps.schemas) };
}

describe('a hire Recruiting made', () => {
  it('maps the event onto People’s keys, terms included', () => {
    const attributes = attributesOf(hired.payload as never);
    expect(attributes).toMatchObject({
      given_name: 'Yuki',
      family_name: 'Tanaka',
      work_email: 'Yuki@Example.com',
      legal_entity_id: hired.payload.legalEntityId,
      employment_type: 'permanent',
      probation_end: '2027-05-02',
      fte: '1.0000',
    });
    expect(attributes).not.toHaveProperty('manager_id');
    expect(attributes).not.toHaveProperty('contract_end');
  });

  it('becomes a pre-hire with what the schema defines, once', async () => {
    const { store, hires } = setup();
    expect(await hires.hired(tx, hired as never)).toEqual({ outcome: 'applied' });
    const [row] = [...store.rows.values()];
    expect(row?.snapshot.status).toBe('pre_hire');
    expect(row?.fields.custom).toMatchObject({ probation_end: '2027-05-02' });
    expect(row?.fields.workEmail).toBe('Yuki@Example.com');
    expect(row?.fields.custom).not.toHaveProperty('employment_type');
    // Delivered twice: the work email is already somebody's.
    const again = await hires.hired(tx, hired as never);
    expect(again.outcome).toBe('unchanged');
    expect(store.rows.size).toBe(1);
  });

  it('keeps the signature the contract was signed with in the company’s signature field', async () => {
    const mark = { kind: 'typed', text: 'Yuki Tanaka', style: 'flowing' } as const;
    const store = inMemoryPeople([
      versionOf(1, [
        define({ key: 'given_name' }),
        define({ key: 'family_name' }),
        email,
        define({ key: 'my_signature', dataType: 'signature', typeConfig: { kind: 'signature' } }),
      ]),
    ]);
    const access = personAccess({ ...store.deps, relations: withSupport(store.deps.relations) });
    const hires = hiresFromRecruiting(access, store.deps.schemas);
    const signed = { ...hired, payload: { ...hired.payload, signature: mark } };
    expect(await hires.hired(tx, signed as never)).toEqual({ outcome: 'applied' });
    const [row] = [...store.rows.values()];
    expect(JSON.parse(String(row?.fields.custom['my_signature']))).toEqual(mark);
  });

  it('is discarded when the hire falls through, found by its work email', async () => {
    const { store, hires } = setup();
    await hires.hired(tx, hired as never);
    expect(await hires.cancelled(tx, cancelled as never)).toEqual({ outcome: 'applied' });
    expect([...store.rows.values()][0]?.snapshot.status).toBe('discarded');
    expect(await hires.cancelled(tx, cancelled as never)).toEqual({ outcome: 'unchanged' });
  });

  it('is ignored without a published schema', async () => {
    const store = inMemoryPeople([]);
    const access = personAccess({ ...store.deps, relations: withSupport(store.deps.relations) });
    const hires = hiresFromRecruiting(access, store.deps.schemas);
    expect((await hires.hired(tx, hired as never)).outcome).toBe('ignored');
    expect(SYSTEM_VIEWER.roles.has('hr')).toBe(true);
  });
});

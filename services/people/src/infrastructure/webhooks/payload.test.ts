import { describe, expect, it } from 'vitest';

import { filterFor, signatureHeader, verifySignature, type StoredEnvelope } from './payload.js';

const updated = (keys: string[]): StoredEnvelope => ({
  eventId: '01890000-0000-7000-8000-000000000001',
  eventName: 'people.person.profile_updated',
  payload: {
    personId: '00000000-0000-4000-8000-0000000000a1',
    changed: keys.map((key) => ({
      key,
      sectionKey: 's',
      classification: 'internal',
      encrypted: false,
    })),
    schemaVersion: 1,
  },
});

describe('a value coming into force, sent to an endpoint (PEO-124)', () => {
  it('is filtered to the allowlist exactly as the update that scheduled it', () => {
    const effective = { ...updated(['cost_centre', 'job_title']), eventName: 'people.person.attribute_effective' };
    const sent = filterFor(effective, ['cost_centre']);
    const kept = (sent?.payload as { changed: { key: string }[] } | undefined)?.changed;
    expect(kept?.map((c) => c.key)).toEqual(['cost_centre']);
    expect(filterFor(effective, ['work_email'])).toBeNull();
  });
});

describe('the facts identity caches, sent to an endpoint', () => {
  const facts: StoredEnvelope = {
    eventId: '01890000-0000-7000-8000-000000000003',
    eventName: 'people.person.identity_facts_changed',
    payload: {
      personId: '00000000-0000-4000-8000-0000000000a1',
      identityAccountId: '00000000-0000-4000-8000-0000000000b1',
      name: { given: 'Ada', family: 'Lovelace', preferred: 'Countess' },
      employmentStart: '2026-10-01',
    },
  };

  it('withholds a name the endpoint may not see, and sends the start date it may', () => {
    const out = filterFor(facts, ['hire_date']);
    expect(out?.payload).toMatchObject({ name: null, employmentStart: '2026-10-01' });
  });

  it('withholds a preferred name on its own', () => {
    const out = filterFor(facts, ['given_name', 'family_name']);
    expect(out?.payload).toMatchObject({
      name: { given: 'Ada', family: 'Lovelace', preferred: null },
      employmentStart: null,
    });
  });

  it('sends nothing when the endpoint may see neither fact', () => {
    expect(filterFor(facts, ['job_title'])).toBeNull();
  });
});

describe('a hire, sent to an endpoint', () => {
  const payload = {
    personId: '00000000-0000-4000-8000-0000000000a1',
    identityAccountId: '00000000-0000-4000-8000-0000000000b1',
    legalEntityId: '00000000-0000-4000-8000-0000000000e1',
    name: { given: 'Ada', family: 'Lovelace', preferred: 'Countess' },
    workEmail: 'ada@acme.test',
    employment: { from: '2026-10-01', to: null },
    status: 'pending',
    managerId: null,
    orgUnitId: null,
    schemaVersion: 3,
    sourceOfRecord: 'own',
  };
  const hired: StoredEnvelope = {
    eventId: '01890000-0000-7000-8000-000000000004',
    eventName: 'people.person.hired',
    payload,
  };

  it('sends the fact of the hire, and only the values the endpoint may see', () => {
    expect(filterFor(hired, ['hire_date', 'work_email'])?.payload).toEqual({
      ...payload,
      name: null,
      legalEntityId: null,
    });
  });
});

describe('filtering for an endpoint', () => {
  it('keeps only allowlisted attributes of an update', () => {
    const out = filterFor(updated(['start_date', 'department', 'phone']), [
      'start_date',
      'department',
    ]);
    if (out === null) throw new Error('filtered to nothing');
    const changed = (out.payload as { changed: { key: string }[] }).changed;
    expect(changed.map((c) => c.key)).toEqual(['start_date', 'department']);
  });

  it('sends nothing when nothing the endpoint may see changed', () => {
    expect(filterFor(updated(['phone']), ['start_date'])).toBeNull();
  });

  it('drops a correction of an attribute the endpoint may not see', () => {
    const correction: StoredEnvelope = {
      eventId: '01890000-0000-7000-8000-000000000002',
      eventName: 'people.person.attribute_corrected',
      payload: { attribute: { key: 'phone' }, supersedes: 'x', reason: null },
    };
    expect(filterFor(correction, ['start_date'])).toBeNull();
    expect(filterFor(correction, ['phone'])).toEqual(correction);
  });

  it('leaves an event with no attributes as it was', () => {
    const status: StoredEnvelope = {
      eventId: '01890000-0000-7000-8000-000000000003',
      eventName: 'people.person.status_changed',
      payload: { previous: 'active', next: 'on_leave' },
    };
    expect(filterFor(status, [])).toBe(status);
  });
});

describe('signing', () => {
  it('signs with every live secret, and either verifies', () => {
    const header = signatureHeader('{"a":1}', ['new-secret', 'old-secret']);
    expect(verifySignature('{"a":1}', header, 'new-secret')).toBe(true);
    expect(verifySignature('{"a":1}', header, 'old-secret')).toBe(true);
    expect(verifySignature('{"a":2}', header, 'new-secret')).toBe(false);
    expect(verifySignature('{"a":1}', header, 'another')).toBe(false);
  });
});

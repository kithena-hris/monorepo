import { describe, expect, it } from 'vitest';
import { failure, err, ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, noTransaction as tx, TENANT, versionOf } from './in-memory.js';
import { inTenantResult, personAccess } from './person-access.js';
import type { Viewer } from './ports.js';

/**
 * Reading and writing a person, through the application layer and nothing
 * else — no resolver, no route. If the rule holds here it holds for every
 * transport, because every transport calls this.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

const salary = define({
  key: 'base_salary',
  dataType: 'money',
  typeConfig: { kind: 'money' },
  visibility: ['self', 'finance', 'hr'],
  ownership: ['hr', 'finance'],
  effectiveDated: true,
  classification: {
    classification: 'confidential',
    piiKind: 'none',
    exportable: true,
    aiEligible: false,
  },
});
const title = define({
  key: 'job_title',
  visibility: ['self', 'manager', 'hr', 'directory'],
  ownership: ['hr'],
  effectiveDated: true,
});
const iban = define({
  key: 'iban',
  dataType: 'bank_account',
  typeConfig: { kind: 'bank_account', country: 'DE' },
  encrypted: true,
  visibility: ['self', 'hr'],
  ownership: ['employee'],
  classification: {
    classification: 'confidential',
    piiKind: 'financial',
    exportable: true,
    aiEligible: false,
  },
});
const phone = define({
  key: 'mobile',
  dataType: 'phone',
  typeConfig: { kind: 'phone' },
  ownership: ['employee'],
});

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer(HR_ACCOUNT, 'hr');
const marco = viewer(MARCO_ACCOUNT);
const ada = viewer(ADA_ACCOUNT);

function setup() {
  const store = inMemoryPeople([versionOf(3, [salary, title, iban, phone])]);
  store.seed(MARCO, { account: MARCO_ACCOUNT });
  store.seed(ADA, { account: ADA_ACCOUNT, fields: { managerId: MARCO } });
  return { store, people: personAccess(store.deps) };
}

const asking = (v: Viewer) => ({
  tenantId: TENANT,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});
const money = { amountMinor: 5_500_000, currency: 'EUR' };

describe('a manager reading a report', () => {
  it('gets a result with no salary key at all — absent, not null', async () => {
    const { people } = setup();
    expect(
      (
        await people.update(tx, {
          ...asking(hr),
          personId: ADA,
          changes: { base_salary: money, job_title: 'Engineer' },
        })
      ).ok,
    ).toBe(true);

    const seen = await people.read(tx, { ...asking(marco), personId: ADA });
    expect(seen.ok).toBe(true);
    if (!seen.ok) return;
    expect(seen.value.attributes).not.toHaveProperty('base_salary');
    expect(Object.keys(seen.value.attributes)).toEqual(['job_title']);
  });

  it('while the person themselves sees it', async () => {
    const { people } = setup();
    await people.update(tx, { ...asking(hr), personId: ADA, changes: { base_salary: money } });
    const seen = await people.read(tx, { ...asking(ada), personId: ADA });
    expect(seen.ok && seen.value.attributes['base_salary']).toEqual(money);
  });

  it('cannot write it, and nothing is stored when they try', async () => {
    const { people, store } = setup();
    const result = await people.update(tx, {
      ...asking(marco),
      personId: ADA,
      changes: { base_salary: money },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FIELD_NOT_WRITABLE');
      expect(result.error.path).toEqual(['base_salary']);
    }
    expect(store.history).toHaveLength(0);
    expect(store.events).toHaveLength(0);
  });
});

describe('a write', () => {
  it('validates against the published version and stamps it on the row', async () => {
    const { people, store } = setup();
    const bad = await people.update(tx, {
      ...asking(ada),
      personId: ADA,
      changes: { mobile: '0612' },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatchObject({ code: 'VALUE_INVALID', path: ['mobile'] });

    const good = await people.update(tx, {
      ...asking(ada),
      personId: ADA,
      changes: { mobile: '+34612345678' },
    });
    expect(good.ok).toBe(true);
    expect(store.rows.get(ADA)?.fields.schemaVersion).toBe(3);
  });

  it('refuses a key the version does not have', async () => {
    const { people } = setup();
    const result = await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { shoe_size: 44 },
    });
    expect(!result.ok && result.error.code).toBe('FIELD_NOT_WRITABLE');
  });

  it('refuses a lifecycle date, which moves through hire() and not an edit', async () => {
    const { people } = setup();
    const result = await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { hire_date: '2026-02-01' },
    });
    expect(!result.ok && result.error.code).toBe('LIFECYCLE_FIELD');
  });

  it('appends history and raises one profile_updated tied to it', async () => {
    const { people, store } = setup();
    await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { job_title: 'Staff Engineer' },
      effectiveFrom: '2026-09-01',
    });
    const [entry] = store.history;
    const [event] = store.events;
    expect(entry).toMatchObject({
      attributeKey: 'job_title',
      value: 'Staff Engineer',
      effectiveFrom: '2026-09-01',
    });
    expect(event?.eventName).toBe('people.person.profile_updated');
    expect(entry?.eventId).toBe(event?.eventId);
  });

  it('seals an encrypted value: last four on read, nothing in history or on the event', async () => {
    const { people, store } = setup();
    const result = await people.update(tx, {
      ...asking(ada),
      personId: ADA,
      changes: { iban: 'DE89370400440532013000' },
    });
    expect(result.ok && result.value.attributes['iban']).toEqual({ last4: '3000' });
    expect(store.history[0]?.value).toBeNull();
    expect(JSON.stringify(store.events)).not.toContain('DE8937');
    expect(store.rows.get(ADA)?.fields.custom).not.toHaveProperty('iban');
  });

  it('does not let a backdated change overwrite a later one already in force', async () => {
    const { people } = setup();
    await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { job_title: 'Staff' },
      effectiveFrom: '2026-09-01',
    });
    await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { job_title: 'Senior' },
      effectiveFrom: '2026-03-01',
    });

    const now = await people.read(tx, { ...asking(hr), personId: ADA });
    expect(now.ok && now.value.attributes['job_title']).toBe('Staff');
    const march = await people.read(tx, { ...asking(hr), personId: ADA, asOf: '2026-04-01' });
    expect(march.ok && march.value.attributes['job_title']).toBe('Senior');
  });

  it('keeps a future-dated change out of today’s projection', async () => {
    const { people } = setup();
    await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { job_title: 'Lead' },
      effectiveFrom: '2026-12-01',
    });
    const now = await people.read(tx, { ...asking(hr), personId: ADA });
    expect(now.ok && now.value.attributes).not.toHaveProperty('job_title');
  });
});

describe('the edges of a write', () => {
  it('refuses an effectiveFrom that is not a calendar date', async () => {
    const { people } = setup();
    const result = await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { job_title: 'x' },
      effectiveFrom: 'next tuesday',
    });
    expect(!result.ok && result.error.path).toEqual(['effectiveFrom']);
  });

  it('claims a sealed unique value by digest, never by its plaintext', async () => {
    const nationalId = define({
      key: 'national_id',
      dataType: 'national_id',
      typeConfig: { kind: 'national_id', country: 'ES', scheme: 'NIF' },
      encrypted: true,
      uniqueScope: 'tenant',
      classification: {
        classification: 'confidential',
        piiKind: 'identity',
        exportable: true,
        aiEligible: false,
      },
    });
    const store = inMemoryPeople([versionOf(1, [nationalId])]);
    store.seed(ADA);
    const claimed: string[] = [];
    const people = personAccess({
      ...store.deps,
      uniques: {
        claim: (_tx, _tenant, claim) => {
          claimed.push(claim.value);
          return Promise.resolve(ok(undefined));
        },
        release: () => Promise.resolve(),
      },
    });

    expect(
      (
        await people.update(tx, {
          ...asking(hr),
          personId: ADA,
          changes: { national_id: '12345678Z' },
        })
      ).ok,
    ).toBe(true);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(claimed[0]).not.toContain('12345678');
  });
});

describe('a correction', () => {
  it('appends a row carrying supersedes, leaves the original, and moves the projection', async () => {
    const { people, store } = setup();
    await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { base_salary: money },
      effectiveFrom: '2026-06-01',
    });
    const original = store.history[0];
    if (!original) throw new Error('no history');

    const fixed = { amountMinor: 5_600_000, currency: 'EUR' };
    const corrected = await people.correct(tx, {
      ...asking(hr),
      personId: ADA,
      supersedes: original.id,
      value: fixed,
      reason: 'typo',
    });
    expect(corrected.ok).toBe(true);
    expect(store.history).toHaveLength(2);
    expect(store.history[0]).toEqual(original);
    expect(store.history[1]).toMatchObject({
      supersedes: original.id,
      effectiveFrom: '2026-06-01',
      value: fixed,
    });
    expect(store.events.at(-1)?.eventName).toBe('people.person.attribute_corrected');

    const seen = await people.read(tx, { ...asking(hr), personId: ADA });
    expect(seen.ok && seen.value.attributes['base_salary']).toEqual(fixed);
  });

  it('is refused to somebody who does not own the field', async () => {
    const { people, store } = setup();
    await people.update(tx, { ...asking(hr), personId: ADA, changes: { base_salary: money } });
    const result = await people.correct(tx, {
      ...asking(marco),
      personId: ADA,
      supersedes: store.history[0]?.id ?? '',
      value: { amountMinor: 1, currency: 'EUR' },
      reason: null,
    });
    expect(!result.ok && result.error.code).toBe('FIELD_NOT_WRITABLE');
  });
});

describe('history and completeness', () => {
  it('shows a manager no history for a field they cannot read', async () => {
    const { people } = setup();
    await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { base_salary: money, job_title: 'Engineer' },
    });
    const history = await people.history(tx, { ...asking(marco), personId: ADA });
    expect(history.ok && history.value.map((e) => e.attributeKey)).toEqual(['job_title']);
  });
});

describe('running a use case in a tenant transaction', () => {
  it('rolls back a refusal and hands it back as a Result', async () => {
    let rolledBack = false;
    const inTenant = async <R>(
      _tenant: string,
      fn: (scope: { tx: typeof tx }) => Promise<R>,
    ): Promise<R> => {
      try {
        return await fn({ tx });
      } catch (cause) {
        rolledBack = true;
        throw cause;
      }
    };

    const refused = await inTenantResult(inTenant, TENANT, () =>
      Promise.resolve(err(failure('NOPE', 'no'))),
    );
    expect(refused).toEqual(err(failure('NOPE', 'no')));
    expect(rolledBack).toBe(true);

    rolledBack = false;
    expect(await inTenantResult(inTenant, TENANT, () => Promise.resolve(ok(1)))).toEqual(ok(1));
    expect(rolledBack).toBe(false);
  });
});

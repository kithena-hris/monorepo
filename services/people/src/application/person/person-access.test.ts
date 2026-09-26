import { describe, expect, it } from 'vitest';
import { failure, err, ok } from '@kithena/domain-kit';
import { PersonHired } from '@kithena/contracts';

import { UTC_CALENDAR, type TenantCalendar } from '../../domain/org/calendar.js';
import { fixedCalendars } from '../org/org.js';
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

  it('claims a national identifier as its country normalises it', async () => {
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
        lock: () => Promise.resolve(),
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
          changes: { national_id: ' 12345678-z ' },
        })
      ).ok,
    ).toBe(true);
    // Keyed and hashed by the claim store, which never keeps this text
    // (`unique.integration.test.ts`); the application hands over one spelling.
    expect(claimed).toEqual(['12345678Z']);
  });

  it('locks every rule it will claim under before the first claim', async () => {
    const unique = (key: string) => define({ key, uniqueScope: 'tenant', visibility: ['hr'] });
    const store = inMemoryPeople([versionOf(1, [unique('a_number'), unique('b_number')])]);
    store.seed(ADA);
    const calls: string[] = [];
    const people = personAccess({
      ...store.deps,
      uniques: {
        lock: (_tx, _tenant, rules) => {
          calls.push(`lock ${rules.map((r) => r.attributeKey).join(',')}`);
          return Promise.resolve();
        },
        claim: (_tx, _tenant, claim) => {
          calls.push(`claim ${claim.attributeKey}`);
          return Promise.resolve(ok(undefined));
        },
        release: () => Promise.resolve(),
      },
    });

    const written = await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { b_number: 'B-1', a_number: 'A-1' },
    });
    expect(written.ok).toBe(true);
    expect(calls).toEqual(['lock b_number,a_number', 'claim b_number', 'claim a_number']);
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

describe('telling identity what it caches', () => {
  const nameKeys = ['given_name', 'family_name', 'preferred_name'].map((key) =>
    define({ key, ownership: ['hr'] }),
  );
  const hireDate = define({
    key: 'hire_date',
    dataType: 'date',
    typeConfig: { kind: 'date' },
    effectiveDated: true,
  });

  function linked(account: string | null = ADA_ACCOUNT) {
    const store = inMemoryPeople([versionOf(3, [title, ...nameKeys, hireDate])]);
    store.seed(ADA, {
      account,
      fields: { givenName: 'Ada', familyName: 'Byron', preferredName: null },
    });
    return { store, people: personAccess(store.deps) };
  }

  const factsEvents = (store: ReturnType<typeof inMemoryPeople>) =>
    store.events.filter((e) => e.eventName === 'people.person.identity_facts_changed');

  it('sends the whole current name when a part of it changes, in the same write', async () => {
    const { store, people } = linked();
    const result = await people.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { family_name: 'Lovelace' },
    });
    expect(result.ok).toBe(true);
    const [facts] = factsEvents(store);
    expect(facts?.payload).toEqual({
      personId: ADA,
      identityAccountId: ADA_ACCOUNT,
      name: { given: 'Ada', family: 'Lovelace', preferred: null },
      employmentStart: '2026-01-01',
    });
    // Two events, two ids: the outbox's primary key would refuse one id twice.
    const [updated] = store.events;
    expect(updated?.payload).toMatchObject({ identityAccountId: ADA_ACCOUNT });
    expect(new Set(store.events.map((e) => e.eventId)).size).toBe(store.events.length);
  });

  it('says nothing to identity when nothing it caches changed', async () => {
    const { store, people } = linked();
    await people.update(tx, { ...asking(hr), personId: ADA, changes: { job_title: 'Engineer' } });
    expect(factsEvents(store)).toEqual([]);
  });

  it('says nothing about a person with no account', async () => {
    const { store, people } = linked(null);
    await people.update(tx, { ...asking(hr), personId: ADA, changes: { given_name: 'Augusta' } });
    expect(factsEvents(store)).toEqual([]);
    expect(store.events[0]?.payload).toMatchObject({ identityAccountId: null });
  });

  it('moves the hire date itself on a correction, and tells identity when it took effect', async () => {
    const { store, people } = linked();
    store.history.push({
      id: '01890000-0000-7000-8000-00000000f001',
      personId: ADA,
      attributeKey: 'hire_date',
      value: '2026-01-01',
      effectiveFrom: '2026-01-01',
      recordedAt: '2025-12-01T09:00:00.000Z',
      actor: { kind: 'system', process: 'test' },
      supersedes: null,
      eventId: null,
    });

    const corrected = await people.correct(tx, {
      ...asking(hr),
      personId: ADA,
      supersedes: '01890000-0000-7000-8000-00000000f001',
      value: '2026-02-01',
      reason: 'started a month later than entered',
    });
    expect(corrected.ok).toBe(true);
    expect(store.rows.get(ADA)?.snapshot.hireDate).toBe('2026-02-01');
    expect(store.rows.get(ADA)?.fields.custom).not.toHaveProperty('hire_date');

    const [facts] = factsEvents(store);
    expect(facts?.effectiveFrom).toBe('2026-01-01');
    expect(facts?.payload).toMatchObject({
      employmentStart: '2026-02-01',
      name: { given: 'Ada', family: 'Byron', preferred: null },
    });
  });

  const lastDay = define({
    key: 'last_working_day',
    dataType: 'date',
    typeConfig: { kind: 'date' },
  });

  /** A history row for a lifecycle date, as a correction needs one to supersede. */
  function dated(store: ReturnType<typeof inMemoryPeople>, key: string, value: string): string {
    const id = `01890000-0000-7000-8000-00000000f${String(store.history.length + 1).padStart(3, '0')}`;
    store.history.push({
      id,
      personId: ADA,
      attributeKey: key,
      value,
      effectiveFrom: value,
      recordedAt: '2025-12-01T09:00:00.000Z',
      actor: { kind: 'system', process: 'test' },
      supersedes: null,
      eventId: null,
    });
    return id;
  }

  it('moves the last working day itself on a correction, never into custom', async () => {
    const store = inMemoryPeople([versionOf(3, [title, ...nameKeys, hireDate, lastDay])]);
    store.seed(ADA, { account: ADA_ACCOUNT });
    const row = store.rows.get(ADA);
    if (row) row.snapshot = { ...row.snapshot, status: 'notice', lastWorkingDay: '2026-12-31' };
    const people = personAccess(store.deps);

    const corrected = await people.correct(tx, {
      ...asking(hr),
      personId: ADA,
      supersedes: dated(store, 'last_working_day', '2026-12-31'),
      value: '2026-11-30',
      reason: 'the notice period was a month shorter',
    });
    expect(corrected.ok).toBe(true);
    expect(store.rows.get(ADA)?.snapshot).toMatchObject({
      lastWorkingDay: '2026-11-30',
      status: 'notice',
    });
    expect(store.rows.get(ADA)?.fields.custom).not.toHaveProperty('last_working_day');
  });

  it('starts a pre-hire whose corrected start date has arrived, in its own event', async () => {
    const { store, people } = linked();
    const row = store.rows.get(ADA);
    if (row) row.snapshot = { ...row.snapshot, status: 'pre_hire', hireDate: '2026-10-01' };

    const corrected = await people.correct(tx, {
      ...asking(hr),
      personId: ADA,
      supersedes: dated(store, 'hire_date', '2026-10-01'),
      value: '2026-09-01',
      reason: 'started a month earlier than entered',
    });
    expect(corrected.ok).toBe(true);
    expect(store.rows.get(ADA)?.snapshot).toMatchObject({
      status: 'active',
      hireDate: '2026-09-01',
    });
    const moved = store.events.find((e) => e.eventName === 'people.person.status_changed');
    expect(moved).toMatchObject({
      effectiveFrom: '2026-09-01',
      payload: { previous: 'pre_hire', next: 'active', reason: 'corrected' },
    });
    expect(new Set(store.events.map((e) => e.eventId)).size).toBe(store.events.length);
  });

  it('returns an active record to pre-hire, caused by the correction, and tells identity the new start', async () => {
    const { store, people } = linked();
    const row = store.rows.get(ADA);
    if (row) row.snapshot = { ...row.snapshot, status: 'active', hireDate: '2026-09-01' };

    const corrected = await people.correct(tx, {
      ...asking(hr),
      personId: ADA,
      supersedes: dated(store, 'hire_date', '2026-09-01'),
      value: '2026-10-15',
      reason: 'the start moved and nobody told us',
    });
    expect(corrected.ok).toBe(true);
    expect(store.rows.get(ADA)?.snapshot).toMatchObject({
      status: 'pre_hire',
      hireDate: '2026-10-15',
    });

    const byName = (name: string) => store.events.find((e) => e.eventName === name);
    const correction = byName('people.person.attribute_corrected');
    expect(byName('people.person.status_changed')).toMatchObject({
      effectiveFrom: '2026-09-01',
      causationId: correction?.eventId,
      payload: { previous: 'active', next: 'pre_hire', reason: 'corrected' },
    });
    expect(byName('people.person.identity_facts_changed')?.payload).toMatchObject({
      employmentStart: '2026-10-15',
    });
  });

  it('refuses to clear a lifecycle date through a correction', async () => {
    const { store, people } = linked();
    const refused = await people.correct(tx, {
      ...asking(hr),
      personId: ADA,
      supersedes: dated(store, 'hire_date', '2026-01-01'),
      value: null,
      reason: null,
    });
    expect(!refused.ok && refused.error.code).toBe('VALUE_INVALID');
  });
});

describe('hiring', () => {
  const nameKeys = ['given_name', 'family_name', 'work_email'].map((key) =>
    define({ key, ownership: ['hr'] }),
  );

  function provisional(account: string | null, fields: Record<string, string | null> = {}) {
    const store = inMemoryPeople([versionOf(3, [title, ...nameKeys])]);
    store.seed(ADA, {
      account,
      fields: { givenName: 'Ada', familyName: 'Lovelace', workEmail: 'ada@acme.test', ...fields },
    });
    const row = store.rows.get(ADA);
    if (row) row.snapshot = { ...row.snapshot, status: 'provisional', hireDate: null };
    return { store, people: personAccess(store.deps) };
  }

  it("starts somebody on their own day, not the server's (PRD §6.8)", async () => {
    // 13:00 UTC on the 22nd is 01:00 on the 23rd in Auckland (NZST, UTC+12).
    const at = '2026-09-22T13:00:00.000Z';
    const hireOn = async (calendar: TenantCalendar, custom: Record<string, unknown>) => {
      const store = inMemoryPeople([versionOf(3, [title, ...nameKeys])], at);
      store.seed(ADA, {
        account: ADA_ACCOUNT,
        fields: { givenName: 'Ada', familyName: 'Lovelace', workEmail: 'ada@acme.test' },
        custom,
      });
      const row = store.rows.get(ADA);
      if (row) row.snapshot = { ...row.snapshot, status: 'provisional', hireDate: null };
      const people = personAccess({ ...store.deps, calendars: fixedCalendars(calendar) });
      const hired = await people.hire(tx, { ...asking(hr), personId: ADA, hireDate: '2026-09-23' });
      return hired.ok ? hired.value.status : hired.error.code;
    };
    // Their own zone decides when nothing more specific does.
    expect(await hireOn(UTC_CALENDAR, { time_zone: 'Pacific/Auckland' })).toBe('active');
    expect(await hireOn(UTC_CALENDAR, {})).toBe('pre_hire');
    // The tenant default is the last resort.
    expect(await hireOn({ ...UTC_CALENDAR, defaultZone: 'Pacific/Auckland' }, {})).toBe('active');
    // Los Angeles (UTC-7) is still on the 22nd.
    expect(await hireOn(UTC_CALENDAR, { time_zone: 'America/Los_Angeles' })).toBe('pre_hire');
  });

  it('tells HR, and nobody else, whose day it is for a person (PEO-119)', async () => {
    const store = inMemoryPeople([versionOf(3, [title])], '2026-09-22T13:00:00.000Z');
    store.seed(ADA, { account: ADA_ACCOUNT, custom: { time_zone: 'Pacific/Auckland' } });
    const people = personAccess(store.deps);
    expect(await people.calendar(tx, { ...asking(hr), personId: ADA })).toEqual(
      ok({ today: '2026-09-23', timeZone: 'Pacific/Auckland' }),
    );
    const self = await people.calendar(tx, { ...asking(ada), personId: ADA });
    expect(self.ok || self.error.code).toBe('FORBIDDEN');
  });

  it('raises status_changed, hired and the facts identity caches, once each', async () => {
    const { store, people } = provisional(ADA_ACCOUNT);
    const hired = await people.hire(tx, { ...asking(hr), personId: ADA, hireDate: '2026-10-01' });
    expect(hired.ok && hired.value.status).toBe('pre_hire');

    expect(store.events.map((e) => e.eventName)).toEqual([
      'people.person.status_changed',
      'people.person.hired',
      'people.person.identity_facts_changed',
    ]);
    const [, hire, facts] = store.events;
    expect(hire?.payload).toMatchObject({
      identityAccountId: ADA_ACCOUNT,
      workEmail: 'ada@acme.test',
      employment: { from: '2026-10-01', to: null },
      schemaVersion: 3,
      sourceOfRecord: 'own',
    });
    // What the contract accepts, with no legal entity in this schema.
    expect(PersonHired.payload.safeParse(hire?.payload).success).toBe(true);
    expect(facts).toMatchObject({
      effectiveFrom: '2026-10-01',
      payload: { identityAccountId: ADA_ACCOUNT, employmentStart: '2026-10-01' },
    });
    expect(new Set(store.events.map((e) => e.eventId)).size).toBe(3);
  });

  it('tells identity once, with the final name, when the hire also renames them', async () => {
    const { store, people } = provisional(ADA_ACCOUNT);
    const hired = await people.hire(tx, {
      ...asking(hr),
      personId: ADA,
      hireDate: '2026-10-01',
      changes: { family_name: 'Byron' },
    });
    expect(hired.ok).toBe(true);
    const facts = store.events.filter(
      (e) => e.eventName === 'people.person.identity_facts_changed',
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]?.payload).toMatchObject({
      name: { given: 'Ada', family: 'Byron', preferred: null },
      employmentStart: '2026-10-01',
    });
    expect(store.events.map((e) => e.eventName)).toContain('people.person.profile_updated');
  });

  it('tells identity nothing about a person with no account', async () => {
    const { store, people } = provisional(null);
    await people.hire(tx, { ...asking(hr), personId: ADA, hireDate: '2026-10-01' });
    expect(store.events.map((e) => e.eventName)).toEqual([
      'people.person.status_changed',
      'people.person.hired',
    ]);
  });

  it('is HR’s to do', async () => {
    const { store, people } = provisional(ADA_ACCOUNT);
    const refused = await people.hire(tx, {
      ...asking(ada),
      personId: ADA,
      hireDate: '2026-10-01',
    });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    expect(store.events).toEqual([]);
  });

  describe('adding somebody by hand (create)', () => {
    const fresh = () => {
      // 09:00 UTC on 2026-09-22.
      const store = inMemoryPeople([versionOf(3, [title, ...nameKeys])]);
      return { store, people: personAccess(store.deps) };
    };
    const lena = { given_name: 'Lena', family_name: 'Moreau', work_email: 'lena@acme.test' };

    it('without a start date: a provisional record, and nobody hired', async () => {
      const { store, people } = fresh();
      const made = await people.create(tx, { ...asking(hr), attributes: lena });
      expect(made.ok && made.value.status).toBe('provisional');
      expect(store.events.map((e) => e.eventName)).not.toContain('people.person.hired');
    });

    it('with a start date that has begun: hired, active, effective from that date', async () => {
      const { store, people } = fresh();
      const made = await people.create(tx, {
        ...asking(hr),
        attributes: lena,
        hireDate: '2026-09-01',
      });
      expect(made.ok && made.value.status).toBe('active');
      const hired = store.events.find((e) => e.eventName === 'people.person.hired');
      expect(hired?.payload).toMatchObject({ employment: { from: '2026-09-01', to: null } });
      // Entered on the 22nd, in force from the 1st: both dates, never one.
      expect(hired?.effectiveFrom).toBe('2026-09-01');
      expect(hired?.occurredAt).toBe('2026-09-22T09:00:00.000Z');
    });

    it('with a start date ahead: hired, pre-hire until then', async () => {
      const { people } = fresh();
      const made = await people.create(tx, {
        ...asking(hr),
        attributes: lena,
        hireDate: '2026-10-01',
      });
      expect(made.ok && made.value.status).toBe('pre_hire');
    });

    it('refuses a start date that is not a calendar date, and a hire without a name', async () => {
      const { people } = fresh();
      const bad = await people.create(tx, { ...asking(hr), attributes: lena, hireDate: '1/10/26' });
      expect(!bad.ok && bad.error.code).toBe('VALUE_INVALID');
      const nameless = await people.create(tx, {
        ...asking(hr),
        attributes: { work_email: 'x@acme.test' },
        hireDate: '2026-09-01',
      });
      expect(!nameless.ok && nameless.error.code).toBe('HIRE_INCOMPLETE');
    });
  });

  describe('hiring somebody already on the books (hireExisting)', () => {
    const ENTITY = '00000000-0000-4000-8000-0000000000e1';
    const entityKey = define({ key: 'legal_entity_id', ownership: ['hr'] });
    const withEntities = (status: 'provisional' | 'active' = 'provisional') => {
      const store = inMemoryPeople([versionOf(3, [title, ...nameKeys, entityKey])]);
      store.seed(ADA, {
        account: ADA_ACCOUNT,
        status,
        fields: { givenName: 'Ada', familyName: 'Lovelace', workEmail: 'ada@acme.test' },
      });
      const row = store.rows.get(ADA);
      if (row && status === 'provisional') row.snapshot = { ...row.snapshot, hireDate: null };
      const calendar: TenantCalendar = {
        ...UTC_CALENDAR,
        entities: new Map([
          [ENTITY, { id: ENTITY, name: 'Acme GmbH', country: 'DE', timeZone: 'Europe/Berlin' }],
        ]),
      };
      return { store, people: personAccess({ ...store.deps, calendars: fixedCalendars(calendar) }) };
    };

    it('hires a provisional record, effective from the start date and recorded now', async () => {
      const { store, people } = provisional(ADA_ACCOUNT);
      const hired = await people.hireExisting(tx, {
        ...asking(hr),
        personId: ADA,
        hireDate: '2026-09-01',
      });
      expect(hired.ok && hired.value.status).toBe('active');
      const hire = store.events.find((e) => e.eventName === 'people.person.hired');
      expect(hire?.effectiveFrom).toBe('2026-09-01');
      expect(hire?.occurredAt).toBe('2026-09-22T09:00:00.000Z');
    });

    it('leaves them pre-hire until a start date ahead', async () => {
      const { people } = provisional(ADA_ACCOUNT);
      const hired = await people.hireExisting(tx, {
        ...asking(hr),
        personId: ADA,
        hireDate: '2026-10-01',
      });
      expect(hired.ok && hired.value.status).toBe('pre_hire');
    });

    it('refuses somebody already employed, and writes nothing', async () => {
      const { store, people } = withEntities('active');
      const refused = await people.hireExisting(tx, {
        ...asking(hr),
        personId: ADA,
        hireDate: '2026-10-01',
        legalEntityId: ENTITY,
      });
      expect(!refused.ok && refused.error.message).toMatch(/already employed/i);
      expect(store.events).toEqual([]);
    });

    it('refuses a provisional record placed nowhere when there is an entity to place them in', async () => {
      const { store, people } = withEntities();
      const refused = await people.hireExisting(tx, {
        ...asking(hr),
        personId: ADA,
        hireDate: '2026-10-01',
      });
      expect(!refused.ok && refused.error.code).toBe('PLACEMENT_REQUIRED');
      expect(store.events).toEqual([]);
    });

    it('is HR’s, and a start date is a calendar date', async () => {
      const { store, people } = provisional(ADA_ACCOUNT);
      const self = await people.hireExisting(tx, {
        ...asking(ada),
        personId: ADA,
        hireDate: '2026-10-01',
      });
      expect(!self.ok && self.error.code).toBe('FORBIDDEN');
      const bad = await people.hireExisting(tx, {
        ...asking(hr),
        personId: ADA,
        hireDate: '1/10/26',
      });
      expect(!bad.ok && bad.error.code).toBe('VALUE_INVALID');
      expect(store.events).toEqual([]);
    });
  });

  it('refuses a hire nobody could find or invite', async () => {
    const { store, people } = provisional(ADA_ACCOUNT, { workEmail: null });
    const refused = await people.hire(tx, { ...asking(hr), personId: ADA, hireDate: '2026-10-01' });
    expect(!refused.ok && refused.error.code).toBe('HIRE_INCOMPLETE');
    expect(store.events).toEqual([]);
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

describe('filtering the directory', () => {
  const costCentre = define({
    key: 'cost_centre',
    visibility: ['self', 'manager', 'hr'],
    ownership: ['hr'],
  });
  const team = define({ key: 'team', visibility: ['directory'], ownership: ['hr'] });
  const number = define({ key: 'employee_number', visibility: ['directory'], ownership: ['hr'] });

  function directory() {
    const store = inMemoryPeople([versionOf(4, [salary, title, iban, costCentre, team, number])]);
    store.seed(MARCO, { account: MARCO_ACCOUNT, custom: { cost_centre: 'ENG-201', team: 'Core' } });
    store.seed(ADA, {
      account: ADA_ACCOUNT,
      fields: { managerId: MARCO },
      custom: { cost_centre: 'ENG-204', team: 'Core' },
    });
    return personAccess(store.deps);
  }

  it('narrows to people holding the value', async () => {
    const people = directory();
    const page = await people.list(tx, {
      ...asking(hr),
      limit: 50,
      where: { cost_centre: 'ENG-204' },
    });
    expect(page.ok && page.value.items.map((p) => p.id)).toEqual([ADA]);
  });

  it('lets anybody filter on what everybody can read', async () => {
    const page = await directory().list(tx, { ...asking(ada), limit: 50, where: { team: 'Core' } });
    expect(page.ok && page.value.items).toHaveLength(2);
  });

  it('refuses a key the viewer can read on some people and not others', async () => {
    // Marco reads Ada's cost centre as her manager, and nobody else's: who
    // matches a filter would tell him the rest.
    const page = await directory().list(tx, {
      ...asking(marco),
      limit: 50,
      where: { cost_centre: 'ENG-201' },
    });
    expect(page).toEqual(
      err(
        failure('FIELD_NOT_FILTERABLE', 'You cannot filter people by cost_centre', ['cost_centre']),
      ),
    );
  });

  it('refuses an encrypted key, a core column and a key nobody defined', async () => {
    const people = directory();
    for (const key of ['iban', 'employee_number', 'hire_date', 'shoe_size']) {
      const page = await people.list(tx, { ...asking(hr), limit: 50, where: { [key]: 'x' } });
      expect(page.ok ? 'allowed' : page.error.code).toBe('FIELD_NOT_FILTERABLE');
    }
  });

  it('refuses a filter combined with asOf, which it cannot honour', async () => {
    const page = await directory().list(tx, {
      ...asking(hr),
      limit: 50,
      asOf: '2026-01-01',
      where: { cost_centre: 'ENG-204' },
    });
    expect(page.ok ? 'allowed' : page.error.code).toBe('FILTER_WITH_AS_OF');
  });
});

describe('searching the directory (PEO-117)', () => {
  const given = define({ key: 'given_name', visibility: ['directory'], ownership: ['hr'] });
  const family = define({ key: 'family_name', visibility: ['directory'], ownership: ['hr'] });
  const email = define({ key: 'work_email', visibility: ['self', 'hr'], ownership: ['hr'] });

  function directory(names = given, surnames = family) {
    const store = inMemoryPeople([versionOf(4, [names, surnames, email])]);
    store.seed(MARCO, {
      account: MARCO_ACCOUNT,
      fields: { givenName: 'Marco', familyName: 'Rossi', workEmail: 'marco@acme.example' },
    });
    store.seed(ADA, {
      account: ADA_ACCOUNT,
      fields: { givenName: 'Ada', familyName: 'Lovelace', workEmail: 'ada@acme.example' },
    });
    return personAccess(store.deps);
  }
  const found = async (
    people: ReturnType<typeof directory>,
    who: typeof hr,
    search: string,
  ): Promise<unknown> => {
    const page = await people.list(tx, { ...asking(who), limit: 50, search });
    return page.ok ? page.value.items.map((p) => p.id) : page.error.code;
  };

  it('matches a full name, case-insensitively, and counts what it matched', async () => {
    const people = directory();
    expect(await found(people, ada, 'ada LOVE')).toEqual([ADA]);
    expect(await people.count(tx, { ...asking(ada), search: 'o' })).toEqual(
      ok({ all: 2, active: 2, notStarted: 0 }),
    );
  });

  it('counts, for HR, who has not started yet: provisional and pre-hire', async () => {
    const store = inMemoryPeople([versionOf(4, [given, family, email])]);
    store.seed(MARCO, { account: MARCO_ACCOUNT, fields: { givenName: 'Marco' } });
    store.seed(ADA, { account: ADA_ACCOUNT, fields: { givenName: 'Ada' }, status: 'pre_hire' });
    store.seed('00000000-0000-4000-8000-0000000000a9', {
      fields: { givenName: 'Adam' },
      status: 'provisional',
    });
    const people = personAccess(store.deps);
    expect(await people.count(tx, asking(hr))).toEqual(ok({ all: 3, active: 1, notStarted: 2 }));
  });

  it('counts nobody’s status for a viewer who may not read it', async () => {
    // A search that finds one person and answers "0 active" says they are on
    // leave. Outside HR the count is who is listed, and a leaver is not (§6.3).
    const store = inMemoryPeople([versionOf(4, [given, family, email])]);
    store.seed(MARCO, { account: MARCO_ACCOUNT, fields: { givenName: 'Marco' } });
    store.seed(ADA, { account: ADA_ACCOUNT, fields: { givenName: 'Ada' }, status: 'on_leave' });
    store.seed('00000000-0000-4000-8000-0000000000a9', {
      fields: { givenName: 'Adam' },
      status: 'terminated',
    });
    const people = personAccess(store.deps);
    expect(await people.count(tx, { ...asking(marco), search: 'Ada' })).toEqual(
      ok({ all: 1, active: 1, notStarted: 0 }),
    );
    expect(await people.count(tx, { ...asking(hr), search: 'Ada' })).toEqual(
      ok({ all: 2, active: 0, notStarted: 0 }),
    );
  });

  it('matches an email only for a viewer who reads everybody’s', async () => {
    const people = directory();
    // HR reads every work email; Ada reads only her own, so for her an email
    // is not searched at all, rather than answered for the people she can see.
    expect(await found(people, hr, 'marco@')).toEqual([MARCO]);
    expect(await found(people, ada, 'marco@')).toEqual([]);
  });

  it('searches only the names readable on everybody, and refuses when there is none', async () => {
    const hidden = (key: string) =>
      define({ key, visibility: ['self', 'manager', 'hr'], ownership: ['hr'] });
    const surnamesOnly = directory(hidden('given_name'));
    expect(await found(surnamesOnly, ada, 'Rossi')).toEqual([MARCO]);
    expect(await found(surnamesOnly, ada, 'Marco')).toEqual([]);
    const noNames = directory(hidden('given_name'), hidden('family_name'));
    expect(await found(noNames, ada, 'Marco')).toBe('FIELD_NOT_FILTERABLE');
    expect(await found(noNames, hr, 'Marco')).toEqual([MARCO]);
  });

  it('refuses a search combined with asOf, which it cannot honour', async () => {
    const page = await directory().list(tx, {
      ...asking(hr),
      limit: 50,
      asOf: '2026-01-01',
      search: 'Ada',
    });
    expect(page.ok ? 'allowed' : page.error.code).toBe('FILTER_WITH_AS_OF');
  });
});

import { describe, expect, it } from 'vitest';
import { fixedClock, type Clock, type PendingEvent } from '@kithena/domain-kit';

import { define, inMemoryPeople, noTransaction as tx, TENANT, versionOf } from './in-memory.js';
import {
  approvalsInbox,
  decidePendingChange,
  pendingFor,
  settlePendingChange,
  whoToTell,
  withdrawPendingChange,
  type Holding,
  type PendingChangeDeps,
} from './pending-changes.js';
import { inMemoryPendingChangeStore } from './pending-store.js';
import { asIntegration, personAccess } from './person-access.js';
import type { Viewer } from './ports.js';

/**
 * Changes held for approval (PEO-077), through the application layer and
 * nothing else: every transport and the import write through `update` and
 * `correct`, so a value held here is held for all of them.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const HANNA = '00000000-0000-4000-8000-0000000000a3';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const HANNA_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';

// Set on by the tenant: money in the clear, dated.
const salary = define({
  key: 'base_salary',
  dataType: 'money',
  typeConfig: { kind: 'money' },
  visibility: ['self', 'finance', 'hr'],
  ownership: ['hr', 'finance'],
  effectiveDated: true,
  requiresApproval: true,
  classification: {
    classification: 'confidential',
    piiKind: 'none',
    exportable: true,
    aiEligible: false,
  },
});
// On by default: financial, sealed, the employee's own to change.
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
const title = define({
  key: 'job_title',
  visibility: ['self', 'manager', 'hr', 'directory'],
  ownership: ['hr'],
  effectiveDated: true,
});

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer(HR_ACCOUNT, 'hr');
const hanna = viewer(HANNA_ACCOUNT, 'hr');
const ada = viewer(ADA_ACCOUNT);
const marco = viewer(MARCO_ACCOUNT);
const asking = (v: Viewer) => ({
  tenantId: TENANT,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});
const money = { amountMinor: 5_500_000, currency: 'EUR' };
const IBAN = 'DE89370400440532013000';

function setup() {
  const store = inMemoryPeople([versionOf(3, [salary, iban, title])]);
  store.seed(ADA, { account: ADA_ACCOUNT });
  store.seed(HANNA, { account: HANNA_ACCOUNT });
  let current = fixedClock('2026-09-22T09:00:00.000Z');
  const clock: Clock = {
    now: () => current.now(),
    today: (tz) => current.today(tz),
    instant: () => current.instant(),
    date: (tz) => current.date(tz),
  };
  const pending = inMemoryPendingChangeStore();
  const published: PendingEvent[] = [];
  const holding: Holding = {
    store: pending,
    publish: (_tx, events) => {
      published.push(...events);
      return Promise.resolve();
    },
    clock,
    newId: store.deps.newId,
  };
  const access = personAccess({ ...store.deps, approvals: holding });
  const deps: PendingChangeDeps = {
    ...holding,
    access,
    schemas: store.deps.schemas,
    reader: store.deps.reader,
    relations: store.deps.relations,
  };
  const later = (iso: string) => {
    current = fixedClock(iso);
  };
  return { store, access, deps, pending, published, later };
}

const named = (events: readonly PendingEvent[], name: string) =>
  events.filter((e) => e.eventName === name);

describe('a write to a field that requires approval', () => {
  it('holds that value, writes the rest, and leaves no trace of it in the record', async () => {
    const { store, access, published } = setup();
    const written = await access.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { base_salary: money, job_title: 'Engineer' },
    });
    if (!written.ok) throw new Error(written.error.message);
    expect(written.value.attributes).toEqual({ job_title: 'Engineer' });
    expect(written.value.held?.map((h) => h.attributeKey)).toEqual(['base_salary']);

    expect(store.history.map((e) => e.attributeKey)).toEqual(['job_title']);
    const updated = named(store.events, 'people.person.profile_updated');
    expect(updated.map((e) => (e.payload as { changed: { key: string }[] }).changed)).toEqual([
      [expect.objectContaining({ key: 'job_title' })],
    ]);
    const [requested] = named(published, 'people.person.change_requested');
    expect(requested?.payload).toMatchObject({ attributeKey: 'base_salary', kind: 'value' });
    // The event names the change, never the value.
    expect(JSON.stringify(requested)).not.toContain('5500000');
  });

  it('holds everything and writes nothing when that is all it carried', async () => {
    const { store, access } = setup();
    const written = await access.update(tx, {
      ...asking(ada),
      personId: ADA,
      changes: { iban: IBAN },
    });
    expect(written.ok && written.value.held).toHaveLength(1);
    expect(store.secrets.size).toBe(0);
    expect(named(store.events, 'people.person.profile_updated')).toEqual([]);
  });

  it('shows the pending value, masked as the field is, only to who may read the field', async () => {
    const { access, deps } = setup();
    await access.update(tx, { ...asking(ada), personId: ADA, changes: { iban: IBAN } });

    const own = await pendingFor(tx, deps, { ...asking(ada), personId: ADA });
    expect(own.ok && own.value).toEqual([
      expect.objectContaining({ attributeKey: 'iban', value: { last4: '3000' }, mine: true }),
    ]);
    const managers = await pendingFor(tx, deps, { ...asking(marco), personId: ADA });
    expect(managers.ok && managers.value).toEqual([]);
    const seen = await access.read(tx, { ...asking(ada), personId: ADA });
    expect(seen.ok && seen.value.attributes).not.toHaveProperty('iban');
  });

  it('is written straight through by HR who says so, and the event records it', async () => {
    const { store, access, published } = setup();
    const written = await access.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { base_salary: money },
      applySensitiveWithoutApproval: true,
    });
    expect(written.ok && written.value.attributes['base_salary']).toEqual(money);
    expect(published).toEqual([]);
    const [updated] = named(store.events, 'people.person.profile_updated');
    expect(updated?.payload).toMatchObject({ appliedWithoutApproval: ['base_salary'] });
  });

  it('is written by the integration that is its source of record, which nobody here could approve', async () => {
    const { access, published } = setup();
    const okta = { connectionId: '00000000-0000-4000-8000-0000000000e1', system: 'Okta' };
    const written = await access.update(tx, {
      ...asIntegration(
        { tenantId: TENANT, correlationId: 'c' },
        { ...okta, owned: new Map([['base_salary', okta]]) },
      ),
      personId: ADA,
      changes: { base_salary: money },
    });
    expect(written.ok && written.value.held).toBeUndefined();
    expect(published).toEqual([]);
  });

  it('refuses that choice to anybody without hr', async () => {
    const { access } = setup();
    const refused = await access.update(tx, {
      ...asking(ada),
      personId: ADA,
      changes: { iban: IBAN },
      applySensitiveWithoutApproval: true,
    });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });
});

describe('deciding a held change', () => {
  async function heldSalary(s: ReturnType<typeof setup>, effectiveFrom = '2026-09-01') {
    const written = await s.access.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { base_salary: money },
      effectiveFrom,
    });
    const id = written.ok ? written.value.held?.[0]?.changeId : undefined;
    if (id === undefined) throw new Error('nothing held');
    return id;
  }

  it('applies an approval from the date asked for, as the requester, caused by the decision', async () => {
    const s = setup();
    const changeId = await heldSalary(s);
    s.later('2026-09-25T09:00:00.000Z');
    const decided = await decidePendingChange(tx, s.deps, {
      ...asking(hanna),
      changeId,
      approve: true,
    });
    expect(decided.ok && decided.value.approval.state).toBe('approved');

    const row = s.store.history.find((e) => e.attributeKey === 'base_salary');
    expect(row).toMatchObject({
      value: money,
      effectiveFrom: '2026-09-01',
      actor: { kind: 'user', userId: HR_ACCOUNT },
    });
    const [decision] = named(s.published, 'people.person.change_decided');
    const [updated] = named(s.store.events, 'people.person.profile_updated');
    expect(decision?.payload).toMatchObject({ decision: 'approved', attributeKey: 'base_salary' });
    expect(updated?.causationId).toBe(decision?.eventId);
    expect(updated?.effectiveFrom).toBe('2026-09-01');
    const seen = await s.access.read(tx, { ...asking(ada), personId: ADA });
    expect(seen.ok && seen.value.attributes['base_salary']).toEqual(money);
  });

  it('is never the requester’s, and never the subject’s, however many roles they hold', async () => {
    const s = setup();
    const changeId = await heldSalary(s);
    const own = await decidePendingChange(tx, s.deps, { ...asking(hr), changeId, approve: true });
    expect(!own.ok && own.error.code).toBe('FORBIDDEN');
    const subject = await decidePendingChange(tx, s.deps, {
      ...asking(viewer(ADA_ACCOUNT, 'hr')),
      changeId,
      approve: true,
    });
    expect(!subject.ok && subject.error.code).toBe('FORBIDDEN');
    const manager = await decidePendingChange(tx, s.deps, {
      ...asking(marco),
      changeId,
      approve: true,
    });
    expect(!manager.ok && manager.error.code).toBe('FORBIDDEN');
    expect(s.store.history.some((e) => e.attributeKey === 'base_salary')).toBe(false);
  });

  it('writes an approved sealed value sealed, and keeps no copy of it', async () => {
    const s = setup();
    const written = await s.access.update(tx, {
      ...asking(ada),
      personId: ADA,
      changes: { iban: IBAN },
    });
    const changeId = written.ok ? (written.value.held?.[0]?.changeId ?? '') : '';
    expect(s.pending.sealed.size).toBe(1);
    const decided = await decidePendingChange(tx, s.deps, {
      ...asking(hr),
      changeId,
      approve: true,
    });
    expect(decided.ok).toBe(true);
    expect(s.store.secrets.get(`${ADA}:iban`)).toBe(IBAN);
    expect(s.pending.sealed.size).toBe(0);
  });

  it('applies nothing on a rejection, and keeps the note', async () => {
    const s = setup();
    const changeId = await heldSalary(s);
    const rejected = await decidePendingChange(tx, s.deps, {
      ...asking(hanna),
      changeId,
      approve: false,
      note: 'Not agreed in the review',
    });
    expect(rejected.ok && rejected.value.approval).toMatchObject({
      state: 'rejected',
      note: 'Not agreed in the review',
    });
    expect(s.store.history.some((e) => e.attributeKey === 'base_salary')).toBe(false);
    const again = await decidePendingChange(tx, s.deps, {
      ...asking(hanna),
      changeId,
      approve: true,
    });
    expect(!again.ok && again.error.code).toBe('APPROVAL_DECIDED');
  });

  it('is withdrawn by the requester alone, and then cannot be approved', async () => {
    const s = setup();
    const changeId = await heldSalary(s);
    const theirs = await withdrawPendingChange(tx, s.deps, { ...asking(hanna), changeId });
    expect(!theirs.ok && theirs.error.code).toBe('FORBIDDEN');
    const own = await withdrawPendingChange(tx, s.deps, { ...asking(hr), changeId });
    expect(own.ok && own.value.approval.state).toBe('withdrawn');
    expect(named(s.published, 'people.person.change_withdrawn')).toHaveLength(1);
    const late = await decidePendingChange(tx, s.deps, {
      ...asking(hanna),
      changeId,
      approve: true,
    });
    expect(!late.ok && late.error.code).toBe('APPROVAL_DECIDED');
  });

  it('expires after seven days: a decision is refused, and the expiry is recorded once', async () => {
    const s = setup();
    const changeId = await heldSalary(s);
    s.later('2026-09-29T09:00:00.000Z');
    const late = await decidePendingChange(tx, s.deps, {
      ...asking(hanna),
      changeId,
      approve: true,
    });
    expect(!late.ok && late.error.code).toBe('APPROVAL_EXPIRED');
    const pendingNow = await pendingFor(tx, s.deps, { ...asking(hr), personId: ADA });
    expect(pendingNow.ok && pendingNow.value).toEqual([]);

    const where = { tenantId: TENANT, changeId, correlationId: 'c' };
    const first = await settlePendingChange(tx, s.deps, where);
    const second = await settlePendingChange(tx, s.deps, where);
    expect(first.ok && first.value).toMatchObject({ state: 'expired', expiredNow: true });
    expect(second.ok && second.value).toMatchObject({ state: 'expired', expiredNow: false });
    expect(named(s.published, 'people.person.change_expired')).toHaveLength(1);
  });
});

describe('a correction to a field that requires approval', () => {
  it('is held with what it supersedes, and applied as a correction once approved', async () => {
    const s = setup();
    await s.access.update(tx, {
      ...asking(hr),
      personId: ADA,
      changes: { base_salary: money },
      effectiveFrom: '2026-09-01',
      applySensitiveWithoutApproval: true,
    });
    const recorded = s.store.history.find((e) => e.attributeKey === 'base_salary');
    const corrected = await s.access.correct(tx, {
      ...asking(hr),
      personId: ADA,
      supersedes: recorded?.id ?? '',
      value: { amountMinor: 5_600_000, currency: 'EUR' },
      reason: 'Typo',
    });
    if (!corrected.ok || !('held' in corrected.value)) throw new Error('not held');
    expect(s.store.history.filter((e) => e.attributeKey === 'base_salary')).toHaveLength(1);

    const decided = await decidePendingChange(tx, s.deps, {
      ...asking(hanna),
      changeId: corrected.value.held.changeId,
      approve: true,
    });
    expect(decided.ok).toBe(true);
    const [fix] = named(s.store.events, 'people.person.attribute_corrected');
    expect(fix?.payload).toMatchObject({ supersedes: recorded?.id, reason: 'Typo' });
    expect(fix?.effectiveFrom).toBe('2026-09-01');
  });
});

describe('the inbox and who is told', () => {
  it('shows HR everything, marking what they may not decide; anybody else, their own', async () => {
    const s = setup();
    await s.access.update(tx, { ...asking(ada), personId: ADA, changes: { iban: IBAN } });
    await s.access.update(tx, {
      ...asking(hr),
      personId: HANNA,
      changes: { base_salary: money },
    });

    const forHr = await approvalsInbox(tx, s.deps, asking(hr));
    expect(forHr.ok && forHr.value.items.map((i) => [i.attributeKey, i.canDecide])).toEqual([
      ['iban', true],
      ['base_salary', false],
    ]);
    const forHanna = await approvalsInbox(tx, s.deps, asking(hanna));
    // Her own pay: HR, but the subject.
    expect(forHanna.ok && forHanna.value.items.map((i) => i.canDecide)).toEqual([true, false]);
    const forAda = await approvalsInbox(tx, s.deps, asking(ada));
    expect(forAda.ok && forAda.value.items.map((i) => [i.attributeKey, i.mine])).toEqual([
      ['iban', true],
    ]);
  });

  it('emails every HR member but the requester and the subject', async () => {
    const s = setup();
    const written = await s.access.update(tx, {
      ...asking(hr),
      personId: HANNA,
      changes: { base_salary: money },
    });
    const change = await s.pending.find(
      tx,
      TENANT,
      written.ok ? (written.value.held?.[0]?.changeId ?? '') : '',
    );
    if (!change) throw new Error('not held');
    const told = await whoToTell(
      tx,
      {
        reader: s.store.deps.reader,
        roles: {
          holdings: () =>
            Promise.resolve(
              new Map([
                [HR_ACCOUNT, new Set(['hr'])],
                [HANNA_ACCOUNT, new Set(['hr'])],
                [ADA_ACCOUNT, new Set(['hr', 'finance'])],
              ]),
            ),
          candidates: () =>
            Promise.resolve([
              { accountId: HR_ACCOUNT, workEmail: 'hr@acme.test' },
              { accountId: HANNA_ACCOUNT, workEmail: 'hanna@acme.test' },
              { accountId: ADA_ACCOUNT, workEmail: 'ada@acme.test' },
            ]),
        },
      },
      change,
    );
    expect(told).toEqual({
      approvers: [{ accountId: ADA_ACCOUNT, email: 'ada@acme.test' }],
      requester: 'hr@acme.test',
    });
  });
});

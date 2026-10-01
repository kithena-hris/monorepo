import { describe, expect, it } from 'vitest';
import { fixedClock, type Clock } from '@kithena/domain-kit';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { inMemoryApprovalFlagStore } from '../person/approval-flag-store.js';
import {
  answerAboutChange,
  askAboutChange,
  markNotUnusual,
  setCheck,
} from '../person/approval-flags.js';
import {
  decidePendingChange,
  type Holding,
  type PendingChangeDeps,
} from '../person/pending-changes.js';
import { inMemoryPendingChangeStore } from '../person/pending-store.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { approvalsView } from './people.js';
import type { ScreenDeps } from './record.js';

/**
 * Flagged approvals (design AI7, AI8): People's rules flag a change for
 * whoever decides it, with the numbers compared, never for the requester;
 * approving a flagged change needs a note; "Not unusual" tunes the checks;
 * the decider may ask the requester; an administrator switches checks.
 */

const TOM = '00000000-0000-4000-8000-0000000000a1';
const TOM_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const NORA = '00000000-0000-4000-8000-0000000000a2';
const NORA_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';
const SOFIA_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

const confidential = {
  classification: 'confidential',
  piiKind: 'none',
  exportable: true,
  aiEligible: false,
} as const;
const salary = define({
  key: 'base_salary',
  label: { default: 'Base salary' },
  dataType: 'money',
  typeConfig: { kind: 'money' },
  visibility: ['self', 'hr'],
  ownership: ['hr'],
  requiresApproval: true,
  classification: confidential,
});
const department = define({
  key: 'department',
  label: { default: 'Department' },
  dataType: 'select',
  typeConfig: {
    kind: 'select',
    options: [{ value: 'sales', label: { default: 'Sales' }, retiredAt: null }],
  },
  visibility: ['self', 'hr', 'manager'],
  ownership: ['hr'],
  classification: { ...confidential, classification: 'internal' },
});

// Sealed pay that only finance reads (PEO-145): a decider without it learns nothing of it.
const sealedPay = define({
  key: 'pay',
  label: { default: 'Pay' },
  dataType: 'money',
  typeConfig: { kind: 'money' },
  encrypted: true,
  visibility: ['self', 'finance'],
  ownership: ['finance'],
  requiresApproval: true,
  classification: { ...confidential, piiKind: 'financial' },
});

const viewer = (accountId: string, roles = ['hr']): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const asking = (v: Viewer) => ({
  tenantId: TENANT,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});

function setup(at: string, facts: Parameters<typeof inMemoryApprovalFlagStore>[0] = {}) {
  const people = inMemoryPeople([versionOf(3, [salary, department, sealedPay])]);
  people.seed(TOM, {
    account: TOM_ACCOUNT,
    custom: { base_salary: { amountMinor: 6_100_000, currency: 'EUR' }, department: 'sales' },
  });
  people.seed(NORA, { account: NORA_ACCOUNT });
  const clock: Clock = fixedClock(at);
  const holding: Holding = {
    store: inMemoryPendingChangeStore(),
    publish: () => Promise.resolve(),
    clock,
    newId: people.deps.newId,
  };
  const access = personAccess({ ...people.deps, clock, approvals: holding });
  const flagStore = inMemoryApprovalFlagStore(facts);
  const pending: PendingChangeDeps = {
    ...holding,
    access,
    schemas: people.deps.schemas,
    reader: people.deps.reader,
    relations: people.deps.relations,
    roles: {
      holdings: () =>
        Promise.resolve(
          new Map([
            [SOFIA_ACCOUNT, new Set(['hr'])],
            [NORA_ACCOUNT, new Set(['hr'])],
          ]),
        ),
    },
    flags: {
      store: flagStore,
      calendars: utcCalendars,
      // The in-memory secrets, as `SecretStore.reveal` opens the real ones.
      sealed: {
        current: (_tx, where) =>
          Promise.resolve(people.secrets.get(`${where.personId}:${where.attributeKey}`) ?? null),
      },
    },
  };
  const deps = {
    service: {
      access,
      schemas: people.deps.schemas,
      inTenant: (_tenant: string, fn: (scope: { tx: never }) => unknown) => fn({ tx: {} as never }),
      pending,
    },
    relations: people.deps.relations,
    clock,
    calendars: utcCalendars,
    personOf: () => Promise.resolve(null),
  } as unknown as ScreenDeps;
  return { access, deps, pending, flagStore, people };
}

const tx = {} as never;
const SOFIA = viewer(SOFIA_ACCOUNT);
const NORA_HR = viewer(NORA_ACCOUNT);

/** Nora asks for Tom's raise, €61k to €84k, from 1 October. */
async function askedForRaise(s: ReturnType<typeof setup>) {
  await s.access.update(tx, {
    ...asking(NORA_HR),
    personId: TOM,
    changes: { base_salary: { amountMinor: 8_400_000, currency: 'EUR' } },
    effectiveFrom: '2026-10-01',
  });
  const view = await approvalsView(s.deps, asking(SOFIA));
  if (!view.ok) throw new Error(view.error.message);
  const item = view.value.items[0];
  if (!item) throw new Error('nothing waiting');
  return { view: view.value, item };
}

const raises = [
  ['5000000', '5100000'],
  ['5000000', '5200000'],
  ['5000000', '5600000'],
].map(([before = '', after = '']) => ({
  before: { amountMinor: before, currency: 'EUR' },
  after: { amountMinor: after, currency: 'EUR' },
}));

describe('a flagged approval (AI7)', () => {
  it('explains itself to the decider, with the numbers it compared against', async () => {
    const s = setup('2026-09-22T10:00:00.000Z', {
      raises,
      band: { minimumMinor: '6200000', maximumMinor: '7800000' },
    });
    const { item } = await askedForRaise(s);
    expect(item.flags.map((f) => f.title)).toEqual(['A 38% raise']);
    expect(item.flags[0]?.detail).toBe(
      'Sales raises this year had a median of 4%, and the largest was 12%.',
    );
    expect(item.comparisons.map((c) => [c.label, c.percent])).toEqual([
      ['This change', '38'],
      ['Median', '4'],
      ['Largest', '12'],
    ]);
    expect(item.flagNote).toBe(
      'This might be fine: a promotion would explain it. Check the reason before you decide.',
    );
    expect(item.flagSummary).toBe('A 38% raise');
    expect(item.canAsk && item.canMark).toBe(true);
  });

  it('never shows the requester which rules their change tripped', async () => {
    const s = setup('2026-09-22T10:00:00.000Z', { raises });
    await askedForRaise(s);
    const theirs = await approvalsView(s.deps, asking(NORA_HR));
    const item = theirs.ok ? theirs.value.items[0] : undefined;
    expect(item?.flags).toEqual([]);
    expect(item?.comparisons).toEqual([]);
    expect(item?.canMark).toBe(false);
  });

  it('asks for a note before approving it, and records what flagged it', async () => {
    const s = setup('2026-09-22T10:00:00.000Z', { raises });
    const { item } = await askedForRaise(s);
    const bare = await decidePendingChange(tx, s.pending, {
      ...asking(SOFIA),
      changeId: item.id,
      approve: true,
    });
    expect(!bare.ok && bare.error.code).toBe('NOTE_REQUIRED');
    const noted = await decidePendingChange(tx, s.pending, {
      ...asking(SOFIA),
      changeId: item.id,
      approve: true,
      note: 'Promotion to Sales manager',
    });
    expect(noted.ok).toBe(true);
    expect(s.flagStore.decided.get(item.id)).toEqual(['raise']);
    const after = await approvalsView(s.deps, asking(SOFIA));
    expect(after.ok && after.value.decided.map((d) => [d.state, d.note, d.decidedBy])).toEqual([
      ['approved', 'Promotion to Sales manager', 'You'],
    ]);
  });
});

describe('Not unusual', () => {
  it('quietens the flag, decides nothing, and is whoever decides it’s alone', async () => {
    const s = setup('2026-09-22T10:00:00.000Z', { raises });
    const { item } = await askedForRaise(s);
    const theirs = await markNotUnusual(tx, s.pending, { ...asking(NORA_HR), changeId: item.id });
    expect(!theirs.ok && theirs.error.code).toBe('FORBIDDEN');
    const marked = await markNotUnusual(tx, s.pending, { ...asking(SOFIA), changeId: item.id });
    expect(marked.ok && marked.value.marked).toBe(1);
    const after = await approvalsView(s.deps, asking(SOFIA));
    const now = after.ok ? after.value.items[0] : undefined;
    expect(now?.flags).toEqual([]);
    expect(now?.state).toBe('pending');
    // Quiet, so approving it needs no note any more.
    expect(
      (await decidePendingChange(tx, s.pending, { ...asking(SOFIA), changeId: item.id, approve: true }))
        .ok,
    ).toBe(true);
  });
});

describe('asking the requester', () => {
  it('lets the decider ask and only the requester answer, once', async () => {
    const s = setup('2026-09-22T10:00:00.000Z', { raises });
    const { item } = await askedForRaise(s);
    const asked = await askAboutChange(tx, s.pending, {
      ...asking(SOFIA),
      changeId: item.id,
      question: 'Is this the promotion we discussed?',
    });
    if (!asked.ok) throw new Error(asked.error.message);
    const byRequester = await approvalsView(s.deps, asking(NORA_HR));
    expect(byRequester.ok && byRequester.value.items[0]?.questions).toMatchObject([
      { question: 'Is this the promotion we discussed?', canAnswer: true, answer: null },
    ]);
    const wrong = await answerAboutChange(tx, s.pending, {
      ...asking(SOFIA),
      questionId: asked.value.id,
      answer: 'Yes',
    });
    expect(!wrong.ok && wrong.error.code).toBe('NOT_FOUND');
    const answered = await answerAboutChange(tx, s.pending, {
      ...asking(NORA_HR),
      questionId: asked.value.id,
      answer: 'Yes, see my email of 24 Sep',
    });
    expect(answered.ok).toBe(true);
    const byDecider = await approvalsView(s.deps, asking(SOFIA));
    expect(byDecider.ok && byDecider.value.items[0]?.questions[0]).toMatchObject({
      answer: 'Yes, see my email of 24 Sep',
      canAnswer: false,
    });
  });

  it('is not the requester’s to ask', async () => {
    const s = setup('2026-09-22T10:00:00.000Z');
    const { item } = await askedForRaise(s);
    const own = await askAboutChange(tx, s.pending, {
      ...asking(NORA_HR),
      changeId: item.id,
      question: 'Hm?',
    });
    expect(!own.ok && own.error.code).toBe('FORBIDDEN');
  });
});

describe('what Kithena checks (AI8)', () => {
  it('lists every check for HR, switched by an administrator alone', async () => {
    const s = setup('2026-09-22T10:00:00.000Z', { raises });
    const { view } = await askedForRaise(s);
    expect(view.checks?.map((c) => [c.code, c.on])).toEqual([
      ['raise', true],
      ['band', true],
      ['bank_after_contact', true],
      ['close_colleagues', true],
      ['payroll_closing', true],
      ['unusual_time', false],
    ]);
    expect(view.canTune).toBe(false);
    const refused = await setCheck(tx, s.pending, { ...asking(SOFIA), code: 'raise', on: false });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    const admin = viewer(SOFIA_ACCOUNT, ['hr', 'people_admin']);
    const off = await setCheck(tx, s.pending, { ...asking(admin), code: 'raise', on: false });
    expect(off.ok && off.value.find((c) => c.code === 'raise')?.on).toBe(false);
    const after = await approvalsView(s.deps, asking(admin));
    expect(after.ok && after.value.items[0]?.flags).toEqual([]);
    expect(after.ok && after.value.canTune).toBe(true);
  });

  it('shows nobody but HR the checks or the last 90 days', async () => {
    const s = setup('2026-09-22T10:00:00.000Z');
    await askedForRaise(s);
    const employee = await approvalsView(s.deps, asking(viewer(TOM_ACCOUNT, [])));
    expect(employee.ok && [employee.value.checks, employee.value.last90]).toEqual([null, null]);
  });
});

describe('sealed pay (PEO-145)', () => {
  const FINANCE_HR = viewer(SOFIA_ACCOUNT, ['hr', 'finance']);
  const PLAIN_HR = viewer(SOFIA_ACCOUNT, ['hr']);

  async function askedForSealedRaise() {
    const s = setup('2026-09-22T10:00:00.000Z', {
      band: { minimumMinor: '6200000', maximumMinor: '7800000' },
    });
    s.people.secrets.set(`${TOM}:pay`, JSON.stringify({ amountMinor: 6_100_000, currency: 'EUR' }));
    const written = await s.access.update(tx, {
      ...asking(viewer(NORA_ACCOUNT, ['hr', 'finance'])),
      personId: TOM,
      changes: { pay: { amountMinor: 8_400_000, currency: 'EUR' } },
      effectiveFrom: '2026-10-01',
    });
    if (!written.ok) throw new Error(written.error.message);
    return s;
  }

  it('flags a decider who may read it with percentages, never an amount', async () => {
    const s = await askedForSealedRaise();
    const view = await approvalsView(s.deps, asking(FINANCE_HR));
    const item = view.ok ? view.value.items.find((i) => i.key === 'pay') : undefined;
    expect(item?.flags.map((f) => [f.code, f.title])).toEqual([['raise', 'A 38% raise']]);
    expect(Object.keys(item?.value ?? {})).toEqual(['last4']);
    // Nothing in the answer carries either amount.
    expect(JSON.stringify(view)).not.toMatch(/6100000|8400000|6,100,000|8,400,000|€61|€84/u);
  });

  it('gives a decider who may not read it no pay flag, and no hint of one', async () => {
    const s = await askedForSealedRaise();
    const view = await approvalsView(s.deps, asking(PLAIN_HR));
    const item = view.ok ? view.value.items.find((i) => i.key === 'pay') : undefined;
    expect(item?.readable).toBe(false);
    expect([item?.flags, item?.comparisons, item?.flagNote, item?.flagSummary]).toEqual([
      [],
      [],
      null,
      null,
    ]);
    // So approving needs no note from them either: nothing was shown to explain.
    const decided = await decidePendingChange(tx, s.pending, {
      ...asking(PLAIN_HR),
      changeId: item?.id ?? '',
      approve: false,
    });
    expect(decided.ok).toBe(true);
    expect(s.flagStore.decided.size).toBe(0);
  });

  it('asks the decider who saw the flag for a note, and keeps only the check’s code', async () => {
    const s = await askedForSealedRaise();
    const view = await approvalsView(s.deps, asking(FINANCE_HR));
    const id = (view.ok ? view.value.items.find((i) => i.key === 'pay')?.id : undefined) ?? '';
    const bare = await decidePendingChange(tx, s.pending, { ...asking(FINANCE_HR), changeId: id, approve: true });
    expect(!bare.ok && bare.error.code).toBe('NOTE_REQUIRED');
    const noted = await decidePendingChange(tx, s.pending, {
      ...asking(FINANCE_HR),
      changeId: id,
      approve: true,
      note: 'Promotion',
    });
    expect(noted.ok).toBe(true);
    expect(s.flagStore.decided.get(id)).toEqual(['raise']);
  });
});

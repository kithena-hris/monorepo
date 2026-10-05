import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import type { IdentifierReview } from '../../domain/person/identifier-review.js';
import type { SignalRow } from '../../domain/person/merge.js';
import type { DuplicateStore } from '../person/duplicates.js';
import { inMemoryFullValuesStore } from '../export/full-values-store.js';
import { fullValuesCounts, type FullValuesRequest } from '../export/full-values.js';
import { inMemoryShareStore } from '../export/share-store.js';
import { sharesCount, type ShareDeps, type ShareRequest } from '../export/share.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { keysetOf, QUEUE_PAGE } from '../person/keyset.js';
import type { Holding, PendingChange, PendingChangeDeps } from '../person/pending-changes.js';
import { inMemoryPendingChangeStore } from '../person/pending-store.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { approvalsView, identifierReviewsView } from './people.js';
import type { ScreenDeps } from './record.js';
import { waitingView } from './waiting.js';

/**
 * Review's decision queues past every page they ever read at once: more
 * changes (200), ID checks (100), duplicate pairs (50), requests for full
 * values and export sends (50) than any of the old caps. Each count is the
 * true total, and paging through each list newest first reaches exactly that
 * many, each once.
 */

const TOM = '00000000-0000-4000-8000-0000000000a1';
const TOM_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const NORA_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';
const SOFIA_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

const CHANGES = 250;
const OWN = 3;
const CHECKS = 250;
const PAIRS = 120;
const REQUESTS = 60;

const NOW = '2026-09-22T10:00:00.000Z';
const minutesAgo = (i: number) => new Date(Date.parse(NOW) - (i + 1) * 60_000).toISOString();
const uuid = (prefix: string, i: number) =>
  `00000000-0000-4000-${prefix}-${String(100_000_000_000 + i)}`;

const internal = {
  classification: 'internal',
  piiKind: 'none',
  exportable: true,
  aiEligible: false,
} as const;
const department = define({
  key: 'department',
  label: { default: 'Department' },
  visibility: ['self', 'hr', 'manager'],
  ownership: ['hr'],
  requiresApproval: true,
  classification: internal,
});
const nif = define({
  key: 'es_nif',
  label: { default: 'NIF' },
  visibility: ['self', 'hr'],
  ownership: ['hr'],
  classification: internal,
});

// What a work-email signal rests on: a pair is shown only to whoever may read it.
const workEmail = define({
  key: 'work_email',
  label: { default: 'Work email' },
  visibility: ['self', 'hr'],
  ownership: ['hr'],
  classification: internal,
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
const SOFIA = viewer(SOFIA_ACCOUNT, ['hr', 'people_admin']);
const tx = {} as never;

/** Every pair a signal: person `d<i>a` and `d<i>b` share a work email. */
const duplicates = (n: number): DuplicateStore => {
  const rows: SignalRow[] = Array.from({ length: n }, (_, i) => ({
    a: uuid('9000', 2 * i),
    b: uuid('9000', 2 * i + 1),
    signal: 'work_email',
    attributeKey: null,
  }));
  return {
    signals: (_tx: unknown, _tenant: string, limit: number | null) =>
      Promise.resolve(limit === null ? rows : rows.slice(0, limit)),
    decided: () => Promise.resolve(new Set()),
  } as unknown as DuplicateStore;
};

function setup() {
  const people = inMemoryPeople([versionOf(3, [department, nif, workEmail])]);
  people.seed(TOM, { account: TOM_ACCOUNT, custom: { department: 'sales' } });
  const clock = fixedClock(NOW);
  const store = inMemoryPendingChangeStore(new Map([[TOM, TOM_ACCOUNT]]));
  const holding: Holding = {
    store,
    publish: () => Promise.resolve(),
    clock,
    newId: people.deps.newId,
  };
  const access = personAccess({
    ...people.deps,
    clock,
    approvals: holding,
    duplicates: duplicates(PAIRS),
  });
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
    personOf: () => Promise.resolve(null),
  } as unknown as ScreenDeps;

  // Changes: Nora's, for Sofia to decide, and three of Sofia's own, waiting on Nora.
  const change = (i: number, by: string): PendingChange => ({
    tenantId: TENANT,
    personId: TOM,
    attributeKey: 'department',
    kind: 'value',
    sealed: false,
    value: `team ${String(i)}`,
    last4: null,
    supersedes: null,
    effectiveFrom: '2026-10-01',
    decidedAs: null,
    approval: {
      id: uuid('8000', i),
      requestedBy: by,
      requestedAt: minutesAgo(i),
      reason: '',
      expiresAt: '2026-09-29T10:00:00.000Z',
      state: 'pending',
      decidedBy: null,
      decidedAt: null,
      note: null,
    },
  });
  for (let i = 0; i < CHANGES + OWN; i += 1) {
    const c = change(i, i < CHANGES ? NORA_ACCOUNT : SOFIA_ACCOUNT);
    store.rows.set(`${TENANT}/${c.approval.id}`, c);
  }
  // ID checks, each on somebody of its own.
  for (let i = 0; i < CHECKS; i += 1) {
    const personId = uuid('7000', i);
    people.seed(personId);
    const review: IdentifierReview = {
      id: uuid('6000', i),
      personId,
      attributeKey: 'es_nif',
      historyId: uuid('5000', i),
      pendingChangeId: null,
      valueHash: `h${String(i)}`,
      keyId: 'k1',
      findings: [{ level: 'mismatch', code: 'checksum', message: 'does not compute' }],
      state: 'pending',
      createdAt: minutesAgo(i),
      decidedBy: null,
      decidedAt: null,
      note: null,
    };
    people.reviews.push(review);
  }
  return { access, deps, pending, people };
}

/** Every page of a list, by its cursor, until it says there is no next one. */
async function everyPage<T>(
  read: (after: string | null) => Promise<{ items: readonly T[]; next: string | null }>,
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let after: string | null = null;
  let pages = 0;
  do {
    const page = await read(after);
    items.push(...page.items);
    after = page.next;
    pages += 1;
  } while (after !== null && pages < 100);
  return { items, pages };
}

describe('Review’s queues past every old cap', () => {
  it('counts each kind’s true total, and pages through exactly that many, newest first', async () => {
    const s = setup();
    const waiting = await waitingView(tx, { access: s.access, pending: s.pending }, asking(SOFIA));
    if (!waiting.ok) throw new Error(waiting.error.message);
    expect({
      changes: waiting.value.changes,
      asked: waiting.value.asked,
      identifiers: waiting.value.identifiers,
      duplicates: waiting.value.duplicates,
    }).toEqual({ changes: CHANGES, asked: OWN, identifiers: CHECKS, duplicates: PAIRS });

    const changes = await everyPage(async (after) => {
      const view = await approvalsView(s.deps, asking(SOFIA), null, { after });
      if (!view.ok) throw new Error(view.error.message);
      return { items: view.value.items, next: view.value.itemsNext };
    });
    expect(changes.pages).toBe(Math.ceil((CHANGES + OWN) / QUEUE_PAGE));
    expect(new Set(changes.items.map((c) => c.id)).size).toBe(CHANGES + OWN);
    // Waiting is everything but her own, waiting on Nora: the count above.
    expect(changes.items.filter((c) => !c.mine).length).toBe(waiting.value.changes);
    const times = changes.items.map((c) => c.requestedAt);
    expect(times).toEqual(times.toSorted().toReversed());

    const checks = await everyPage(async (after) => {
      const view = await identifierReviewsView(s.deps, asking(SOFIA), { after });
      if (!view.ok) throw new Error(view.error.message);
      return { items: view.value.items, next: view.value.next };
    });
    expect(new Set(checks.items.map((c) => c.personId)).size).toBe(waiting.value.identifiers);
    expect(checks.items[0]?.enteredAt).toBe(minutesAgo(0));

    const pairs = await everyPage(async (after) => {
      const page = await s.access.duplicatePage(tx, {
        ...asking(SOFIA),
        after,
        limit: QUEUE_PAGE,
      });
      if (!page.ok) throw new Error(page.error.message);
      return { items: page.value.items, next: page.value.next };
    });
    expect(new Set(pairs.items.map((c) => c.personIds.join('~'))).size).toBe(
      waiting.value.duplicates,
    );
  });

  it('opens one change or one person’s ID check a link names, wherever it is in the queue', async () => {
    const s = setup();
    const far = uuid('8000', CHANGES - 1);
    const change = await approvalsView(s.deps, asking(SOFIA), null, { only: far });
    expect(change.ok && change.value.items.map((c) => c.id)).toEqual([far]);
    expect(change.ok && change.value.decided).toEqual([]);
    const person = uuid('7000', CHECKS - 1);
    const check = await identifierReviewsView(s.deps, asking(SOFIA), { person });
    expect(check.ok && check.value.items.map((c) => c.personId)).toEqual([person]);
  });

  it('counts requests for full values and export sends past fifty, whose they are', async () => {
    const requests = inMemoryFullValuesStore();
    const shares = inMemoryShareStore();
    const approval = (i: number, by: string) => ({
      id: uuid('4000', i),
      requestedBy: by,
      requestedAt: minutesAgo(i),
      reason: 'Payroll audit',
      expiresAt: '2026-09-29T10:00:00.000Z',
      state: 'pending' as const,
      decidedBy: null,
      decidedAt: null,
      note: null,
    });
    for (let i = 0; i < REQUESTS + OWN; i += 1) {
      const by = i < REQUESTS ? NORA_ACCOUNT : SOFIA_ACCOUNT;
      const request: FullValuesRequest = {
        tenantId: TENANT,
        approval: approval(i, by),
        attributeKeys: ['base_salary'],
        asOf: null,
        personIds: null,
        filter: null,
        exportId: null,
        fileName: null,
        grant: null,
      };
      await requests.insert(tx, request);
      // One in ten sent to Sofia herself: never hers to decide.
      const share = {
        tenantId: TENANT,
        approval: approval(i, by),
        recipient: i % 10 === 0 ? SOFIA_ACCOUNT : TOM_ACCOUNT,
        exportId: null,
        people: 6,
      } as unknown as ShareRequest;
      await shares.insert(tx, share);
    }
    const clock = fixedClock(NOW);
    expect(await fullValuesCounts(tx, { requests, clock }, asking(SOFIA))).toEqual({
      toDecide: REQUESTS,
      mine: OWN,
    });
    const listed = await everyPage(async (after) => {
      const read = await requests.list(tx, TENANT, {
        requestedBy: null,
        limit: QUEUE_PAGE + 1,
        before: after,
      });
      const page = read.slice(0, QUEUE_PAGE);
      return {
        items: page,
        next: read.length > QUEUE_PAGE ? (page.at(-1)?.approval.id ?? null) : null,
      };
    });
    expect(listed.items).toHaveLength(REQUESTS + OWN);

    const decidable = Array.from({ length: REQUESTS }, (_, i) => i).filter((i) => i % 10 !== 0);
    expect(await sharesCount(tx, { shares, clock } as unknown as ShareDeps, asking(SOFIA))).toBe(
      decidable.length,
    );
    const waiting = await everyPage(async (after) => {
      const read = await shares.waiting(tx, TENANT, NOW, QUEUE_PAGE + 1, {
        after: keysetOf(after),
      });
      const page = read.slice(0, QUEUE_PAGE);
      const last = page.at(-1);
      return {
        items: page,
        next:
          read.length > QUEUE_PAGE && last !== undefined
            ? `${last.approval.requestedAt}~${last.approval.id}`
            : null,
      };
    });
    expect(new Set(waiting.items.map((q) => q.approval.id)).size).toBe(REQUESTS + OWN);
  });
});

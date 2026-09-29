import { describe, expect, it } from 'vitest';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { PeopleService } from '../person/service.js';
import type { ScreenDeps } from './record.js';
import { transferHistoryView, type TransferDeps, type TransferRow } from './transfers.js';

/**
 * Import & export's one history (V6): imports and exports together, newest
 * first, for HR and People administrators, each with who ran it, what it was
 * and what came of it. A download only where one still opens for this viewer.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const SOFIA = '00000000-0000-4000-8000-0000000000a2';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const SOFIA_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const NOW = '2026-09-22T09:00:00.000Z';
const CHECKSUM = 'a'.repeat(64);

const everyone = ['self', 'manager', 'hr', 'directory'] as const;

const rows: TransferRow[] = [
  {
    kind: 'export',
    id: '00000000-0000-4000-9000-000000000003',
    at: '2026-09-22T08:10:00.000Z',
    actor: ADA_ACCOUNT,
    name: null,
    counts: null,
    rowCount: 124,
    format: 'xlsx',
    reason: 'Quarterly headcount for Finance',
    fileNames: ['people-2026-09-22.xlsx'],
    expiresAt: '2026-09-23T08:10:00.000Z',
    checksum: null,
    reportExpiresAt: null,
  },
  {
    kind: 'import',
    id: '00000000-0000-4000-9000-000000000002',
    at: '2026-09-21T14:02:00.000Z',
    actor: ADA_ACCOUNT,
    name: 'new-joiners-sep.csv',
    counts: { created: 12, updated: 0, unchanged: 1, blocked: 1, duplicate: 1, incomplete: 3 },
    rowCount: null,
    format: null,
    reason: null,
    fileNames: null,
    expiresAt: null,
    checksum: CHECKSUM,
    reportExpiresAt: '2026-09-28T14:02:00.000Z',
  },
  {
    kind: 'export',
    id: '00000000-0000-4000-9000-000000000001',
    at: '2026-09-20T09:02:00.000Z',
    actor: SOFIA_ACCOUNT,
    name: null,
    counts: null,
    rowCount: 412,
    format: 'csv',
    reason: null,
    fileNames: ['people-2026-09-20.csv'],
    expiresAt: '2026-09-21T09:02:00.000Z',
    checksum: null,
    reportExpiresAt: null,
  },
];

function world() {
  const store = inMemoryPeople(
    [
      versionOf(1, [
        define({ key: 'given_name', visibility: [...everyone] }),
        define({ key: 'family_name', visibility: [...everyone] }),
      ]),
    ],
    NOW,
  );
  store.seed(ADA, { account: ADA_ACCOUNT, custom: { given_name: 'Ada', family_name: 'Lovelace' } });
  store.seed(SOFIA, {
    account: SOFIA_ACCOUNT,
    custom: { given_name: 'Sofia', family_name: 'Lindqvist' },
  });
  const service: PeopleService = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  };
  const asked: { before: string | null; limit: number }[] = [];
  const base: ScreenDeps = {
    service,
    relations: store.deps.relations,
    clock: store.deps.clock,
    calendars: utcCalendars,
    personOf: (_tx, _tenant, account) =>
      Promise.resolve(
        [...store.rows.values()].find((r) => r.snapshot.identityAccountId === account)?.snapshot
          .id ?? null,
      ),
    gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
  };
  const deps: TransferDeps = {
    ...base,
    transfers: {
      page: (_tx, tenantId, page) => {
        expect(tenantId).toBe(TENANT);
        asked.push(page);
        return Promise.resolve(rows.slice(0, page.limit));
      },
    },
    reports: {
      sign: (key, expiresAt) =>
        Promise.resolve(`https://files.test/${encodeURIComponent(key)}?expires=${expiresAt}`),
    },
  };
  const as = (accountId: string, ...roles: string[]) => ({
    tenantId: TENANT,
    viewer: { accountId, roles: new Set(roles) },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  });
  return { deps, as, asked };
}

describe('the import and export history', () => {
  it('is HR’s and People administrators’, and nobody else’s', async () => {
    const { deps, as } = world();
    const refused = await transferHistoryView(deps, as(ADA_ACCOUNT), null);
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    expect((await transferHistoryView(deps, as(ADA_ACCOUNT, 'hr'), null)).ok).toBe(true);
    expect((await transferHistoryView(deps, as(SOFIA_ACCOUNT, 'people_admin'), null)).ok).toBe(
      true,
    );
  });

  it('names what each was, who ran it, and what came of it, newest first', async () => {
    const { deps, as } = world();
    const read = await transferHistoryView(deps, as(SOFIA_ACCOUNT, 'hr'), null);
    if (!read.ok) throw new Error(read.error.message);
    expect(
      read.value.items.map((i) => [i.kind, i.title, i.by.name, i.imported, i.exported]),
    ).toEqual([
      ['export', 'Quarterly headcount for Finance', 'Ada Lovelace', null, { rows: 124, format: 'xlsx' }],
      ['import', 'new-joiners-sep.csv', 'Ada Lovelace', { created: 12, updated: 0, blocked: 2 }, null],
      // No reason given: the file it made is what it was.
      ['export', 'people-2026-09-20.csv', 'Sofia Lindqvist', null, { rows: 412, format: 'csv' }],
    ]);
  });

  it('offers an export’s download only to whoever asked for it, while its link still opens', async () => {
    const { deps, as } = world();
    const ada = await transferHistoryView(deps, as(ADA_ACCOUNT, 'hr'), null);
    const sofia = await transferHistoryView(deps, as(SOFIA_ACCOUNT, 'hr'), null);
    if (!ada.ok || !sofia.ok) throw new Error('refused');
    expect(ada.value.items.map((i) => i.downloadable)).toEqual([true, false, false]);
    // Sofia's own export expired yesterday; Ada's is not hers to open.
    expect(sofia.value.items.map((i) => i.downloadable)).toEqual([false, false, false]);
  });

  it('links an import’s blocked-row report while it is kept, for a day at most', async () => {
    const { deps, as } = world();
    const read = await transferHistoryView(deps, as(SOFIA_ACCOUNT, 'hr'), null);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.items[1]?.reportUrl).toBe(
      `https://files.test/${encodeURIComponent(`imports/${TENANT}/${CHECKSUM}/blocked-rows.csv`)}?expires=2026-09-23T09:00:00.000Z`,
    );
    expect(read.value.items.filter((i) => i.reportUrl !== null)).toHaveLength(1);
  });

  it('pages: a cursor when there are more, passed back as `before`', async () => {
    const { deps, as, asked } = world();
    const read = await transferHistoryView(deps, as(SOFIA_ACCOUNT, 'hr'), null, 2);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.items).toHaveLength(2);
    expect(read.value.next).toBe('00000000-0000-4000-9000-000000000002');
    expect(asked).toEqual([{ before: null, limit: 3 }]);
  });
});

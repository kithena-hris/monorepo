import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { fixedClock, type PendingEvent } from '@kithena/domain-kit';

import { noTransaction as tx, TENANT } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { utcCalendars } from '../org/org.js';
import { ADA, asking, FINANCE, financeTenant, HR, MANAGER, MARCO } from './fixture.js';
import { inMemoryExportLedger } from './ledger.js';
import { localObjectStore } from './object-store.js';
import {
  decideExportShare,
  exportRecord,
  previewShare,
  shareExport,
  shareView,
  type ShareChoice,
  type ShareDeps,
} from './share.js';
import { inMemoryShareStore } from './share-store.js';

const NORA = '00000000-0000-4000-8000-0000000000fd';
const ADMIN = { accountId: NORA, roles: new Set(['people_admin', 'hr', 'finance']) };

const candidates = [
  { accountId: HR.accountId, personId: ADA, name: 'Ada Lovelace', workEmail: 'ada@acme.test' },
  {
    accountId: FINANCE.accountId,
    personId: 'p-sofia',
    name: 'Sofia Lindqvist',
    workEmail: 'sofia@acme.test',
  },
  {
    accountId: MANAGER.accountId,
    personId: MARCO,
    name: 'Marco Test',
    workEmail: 'marco@acme.test',
  },
  { accountId: NORA, personId: 'p-nora', name: 'Nora Becker', workEmail: 'nora@acme.test' },
];

type Holders = readonly (readonly [string, readonly string[]])[];
const HOLDERS: Holders = [
  [HR.accountId, ['hr']],
  [FINANCE.accountId, ['finance']],
  [NORA, ['people_admin']],
];

function setup(holders: Holders = HOLDERS) {
  const store = financeTenant();
  const clock = fixedClock('2026-10-01T12:00:00.000Z');
  const objects = localObjectStore({
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    clock,
    baseUrl: 'https://files.kithena.test/o',
  });
  const events: PendingEvent[] = [];
  const shares = inMemoryShareStore();
  const ledger = inMemoryExportLedger();
  let ids = 0;
  const holdings = new Map<string, ReadonlySet<string>>(
    holders.map(([a, r]) => [a, new Set(r)] as const),
  );
  const deps: ShareDeps = {
    calendars: utcCalendars,
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    relations: store.deps.relations,
    records: store.deps,
    clock,
    store: objects,
    notifier: { notify: () => Promise.resolve() },
    audit: { publish: (_tx, e) => (events.push(...e), Promise.resolve()) },
    ledger,
    newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
    shares,
    accounts: {
      candidates: () => Promise.resolve(candidates),
      holdings: () => Promise.resolve(holdings),
    },
    segments: { all: () => Promise.resolve([]) },
    company: () => Promise.resolve({ name: 'Acme', origin: 'https://acme.app.kithena.test' }),
    mailer: { send: () => Promise.resolve() },
  };
  return { deps, events, shares, ledger };
}

const choice: ShareChoice = {
  format: 'xlsx',
  fields: ['given_name', 'job_title', 'base_salary'],
  asOf: '2026-06-30',
  filter: 'Everyone in Madrid',
  reason: 'Budget planning for 2027',
};

describe('before the file exists', () => {
  it('reads whom it is for from the sentence, and finds nothing they could not read', async () => {
    const { deps } = setup();
    const preview = await previewShare(tx, deps, asking(HR), {
      choice,
      sentence: 'salaries for Madrid engineering as of 30 June, for Finance’s 2027 budget',
    });
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.value).toMatchObject({
      recipient: { accountId: FINANCE.accountId, name: 'Sofia Lindqvist' },
      people: 3,
      gap: null,
      approvers: [],
      tooLarge: false,
      emailed: true,
    });
    expect(preview.value.sensitive).toEqual(['base_salary']);
    expect(preview.value.candidates.map((c) => c.name)).not.toContain('Ada Lovelace');
  });

  it('spots what a recipient could not read, and who would approve it', async () => {
    const { deps } = setup();
    const preview = await previewShare(tx, deps, asking(HR), {
      choice,
      recipient: MANAGER.accountId,
    });
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.value.gap?.fields).toEqual([
      { key: 'given_name', label: 'Given name', people: 3 },
      { key: 'job_title', label: 'Job title', people: 2 },
      { key: 'base_salary', label: 'Base salary', people: 3 },
    ]);
    expect(preview.value.approvers).toEqual([{ accountId: NORA, name: 'Nora Becker' }]);
  });
});

describe('sending', () => {
  it('goes at once to somebody who could read all of it, by email, kept a week', async () => {
    const { deps, events, ledger } = setup();
    const shared = await shareExport(tx, deps, asking(HR), {
      choice,
      recipient: FINANCE.accountId,
    });
    if (!shared.ok) throw new Error(shared.error.message);
    expect(shared.value.value.status).toBe('sent');
    const exportId = shared.value.value.status === 'sent' ? shared.value.value.exportId : '';
    expect(shared.value.mail).toEqual([
      {
        email: 'sofia@acme.test',
        url: `https://acme.app.kithena.test/people/export?export=${exportId}`,
        notice: 'export_shared',
        dedupeKey: `export-shared/${exportId}/${FINANCE.accountId}`,
      },
    ]);
    expect(events.map((e) => e.eventName)).toEqual([
      'people.export.completed',
      'people.export.shared',
    ]);
    expect(await ledger.find(tx, TENANT, exportId)).toMatchObject({
      sharedWith: FINANCE.accountId,
      expiresAt: '2026-10-08T12:00:00.000Z',
    });
    // An email says there is a file and where to sign in; never who or what is in it.
    expect(JSON.stringify([shared.value.mail, events])).not.toMatch(/Grace|9000000|Marco/u);
  });

  it('waits for a People administrator when it holds more than the recipient could read', async () => {
    const { deps, events, ledger } = setup();
    const shared = await shareExport(tx, deps, asking(HR), {
      choice,
      recipient: MANAGER.accountId,
    });
    if (!shared.ok) throw new Error(shared.error.message);
    expect(shared.value.value).toMatchObject({
      status: 'waiting',
      approvers: [{ accountId: NORA, name: 'Nora Becker' }],
    });
    const requestId = shared.value.value.status === 'waiting' ? shared.value.value.requestId : '';
    expect(shared.value.mail).toEqual([
      {
        email: 'nora@acme.test',
        url: `https://acme.app.kithena.test/people/export?share=${requestId}`,
        notice: 'export_share_requested',
        dedupeKey: `export-share/${requestId}/${NORA}`,
      },
    ]);
    expect(events.map((e) => e.eventName)).toEqual(['people.export.share_requested']);
    expect(ledger.rows.size).toBe(0);
    const seen = await shareView(tx, deps, asking(HR), requestId);
    expect(seen.ok && seen.value).toMatchObject({
      state: 'pending',
      mine: true,
      canDecide: false,
      approvers: [{ accountId: NORA, name: 'Nora Becker' }],
      gap: { fields: [{ key: 'given_name' }, { key: 'job_title' }, { key: 'base_salary' }] },
    });
  });

  it('is refused with nobody to approve it', async () => {
    const { deps } = setup([
      [HR.accountId, ['people_admin']],
      [FINANCE.accountId, ['finance']],
    ]);
    const shared = await shareExport(tx, deps, asking(HR), {
      choice,
      recipient: MANAGER.accountId,
    });
    expect(!shared.ok && shared.error.code).toBe('NO_APPROVER');
  });

  it('is refused to oneself, or to somebody who does not sign in here', async () => {
    const { deps } = setup();
    for (const recipient of [HR.accountId, '00000000-0000-4000-8000-000000000999']) {
      const shared = await shareExport(tx, deps, asking(HR), { choice, recipient });
      expect(!shared.ok && shared.error.code).toBe('RECIPIENT_UNKNOWN');
    }
  });
});

describe('approving', () => {
  async function waiting() {
    const s = setup();
    const shared = await shareExport(tx, s.deps, asking(HR), {
      choice,
      recipient: MANAGER.accountId,
    });
    if (!shared.ok || shared.value.value.status !== 'waiting') throw new Error('not waiting');
    return { ...s, requestId: shared.value.value.requestId };
  }

  it('is not for HR, the recipient, or the requester', async () => {
    const { deps, requestId } = await waiting();
    for (const viewer of [FINANCE, MANAGER, HR]) {
      const decided = await decideExportShare(tx, deps, asking(viewer), requestId, {
        approve: true,
      });
      expect(!decided.ok && decided.error.code).toBe('FORBIDDEN');
    }
  });

  it('builds the file as the requester, sends it, and records who approved it', async () => {
    const { deps, requestId, events } = await waiting();
    const decided = await decideExportShare(tx, deps, asking(ADMIN), requestId, {
      approve: true,
    });
    if (!decided.ok) throw new Error(decided.error.message);
    expect(decided.value.value).toMatchObject({
      state: 'approved',
      decidedBy: { accountId: NORA, name: 'Nora Becker' },
      canDecide: false,
    });
    const exportId = decided.value.value.exportId ?? '';
    expect(decided.value.mail).toEqual([
      expect.objectContaining({ email: 'marco@acme.test', notice: 'export_shared' }),
    ]);
    expect(events.map((e) => e.eventName)).toEqual([
      'people.export.share_requested',
      'people.export.share_decided',
      'people.export.completed',
      'people.export.shared',
    ]);

    const seen = await exportRecord(tx, deps, asking(MANAGER), exportId);
    if (!seen.ok) throw new Error(seen.error.message);
    expect(seen.value).toMatchObject({
      sentTo: { accountId: MANAGER.accountId, name: 'Marco Test' },
      approvedBy: { accountId: NORA, name: 'Nora Becker' },
      openedAt: '2026-10-01T12:00:00.000Z',
      rowCount: 3,
      fields: ['Given name', 'Job title', 'Base salary'],
      sensitive: 1,
      reason: 'Budget planning for 2027',
      keptUntil: null,
    });
    expect(seen.value.about?.paragraphs[1]).toBe(
      'Made by Ada Lovelace on 1 October 2026 for Marco Test. Why: Budget planning for 2027.',
    );
    expect(seen.value.links).toHaveLength(1);
  });

  it('answers a rejection, and the request is shown to nobody else', async () => {
    const { deps, requestId, ledger } = await waiting();
    const decided = await decideExportShare(tx, deps, asking(ADMIN), requestId, {
      approve: false,
      note: 'Ask Marco’s director',
    });
    expect(decided.ok && decided.value.value.state).toBe('rejected');
    expect(ledger.rows.size).toBe(0);
    const stranger = { accountId: '00000000-0000-4000-8000-000000000777', roles: new Set(['hr']) };
    const seen = await shareView(tx, deps, asking(stranger), requestId);
    expect(!seen.ok && seen.error.code).toBe('NOT_FOUND');
  });
});

describe('the finished export', () => {
  it('opens only for whoever asked and whom it was sent to', async () => {
    const { deps } = setup();
    const shared = await shareExport(tx, deps, asking(HR), {
      choice,
      recipient: FINANCE.accountId,
    });
    const exportId =
      shared.ok && shared.value.value.status === 'sent' ? shared.value.value.exportId : '';
    const theirs = await exportRecord(tx, deps, asking(MANAGER), exportId);
    expect(!theirs.ok && theirs.error.code).toBe('NOT_FOUND');
    const mine = await exportRecord(tx, deps, asking(HR), exportId);
    expect(mine.ok && mine.value.openedAt).toBeNull();
  });
});

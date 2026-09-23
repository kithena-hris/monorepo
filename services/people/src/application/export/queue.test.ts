import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { fixedClock, type PendingEvent } from '@kithena/domain-kit';

import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { ADA, asking, FINANCE, financeTenant, HR } from './fixture.js';
import type { ExportJobDeps } from './job.js';
import { inMemoryExportLedger } from './ledger.js';
import { localObjectStore } from './object-store.js';
import { purgeBefore, QUEUE_THRESHOLD, requestExport, runQueuedExport } from './queue.js';

function setup() {
  const store = financeTenant();
  const clock = fixedClock('2026-09-22T09:00:00.000Z');
  const objects = localObjectStore({
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    clock,
    baseUrl: 'https://files.kithena.test/v1/exports/files',
  });
  const events: PendingEvent[] = [];
  const sent: string[] = [];
  const ledger = inMemoryExportLedger();
  let ids = 0;
  const deps: ExportJobDeps = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    relations: store.deps.relations,
    records: store.deps,
    clock: store.deps.clock,
    store: objects,
    notifier: { notify: (m) => (sent.push(m.exportId), Promise.resolve()) },
    audit: { publish: (_tx, e) => (events.push(...e), Promise.resolve()) },
    ledger,
    newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
  };
  return { deps, objects, events, sent, ledger };
}

/** More people than the threshold, as a selection: the count is the selection's. */
const many = Array.from({ length: QUEUE_THRESHOLD + 1 }, () => ADA);

describe('requesting an export', () => {
  it('runs while the requester waits at 2,000 rows or fewer', async () => {
    const { deps, events } = setup();
    const done = await requestExport(tx, deps, { ...asking(HR), format: 'csv', reason: 'audit' });
    expect(done.ok && done.value.status).toBe('completed');
    expect(events).toHaveLength(1);
  });

  it('is queued over 2,000 rows: recorded, not yet built, announced or sent', async () => {
    const { deps, events, sent, ledger } = setup();
    const queued = await requestExport(tx, deps, {
      ...asking(HR),
      format: 'xlsx',
      personIds: many,
      reason: 'audit',
    });
    if (!queued.ok || queued.value.status !== 'queued') throw new Error('not queued');
    expect(queued.value.job.request.viewer).toEqual({ accountId: HR.accountId, roles: ['hr'] });
    expect([...ledger.rows.values()]).toEqual([
      { status: 'queued', exportId: queued.value.exportId, requestedBy: HR.accountId },
    ]);
    expect(events).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('refuses a queued financial export without a reason before a job exists', async () => {
    const { deps, ledger } = setup();
    const refused = await requestExport(tx, deps, {
      ...asking(FINANCE),
      format: 'xlsx',
      personIds: many,
    });
    expect(!refused.ok && refused.error.code).toBe('EXPORT_REASON_REQUIRED');
    expect(ledger.rows.size).toBe(0);
  });
});

describe('a queued export, run', () => {
  it('is idempotent on its export id: a retry announces and notifies nothing more', async () => {
    const { deps, events, sent } = setup();
    const queued = await requestExport(tx, deps, {
      ...asking(HR),
      format: 'csv',
      personIds: many,
      reason: 'audit',
    });
    if (!queued.ok || queued.value.status !== 'queued') throw new Error('not queued');

    const first = await runQueuedExport(tx, deps, queued.value.job);
    const again = await runQueuedExport(tx, deps, queued.value.job);
    expect(first.ok && first.value.exportId).toBe(queued.value.exportId);
    expect(again.ok && again.value.links).toEqual(first.ok && first.value.links);
    expect(events).toHaveLength(1);
    expect(sent).toEqual([queued.value.exportId]);
  });
});

describe('the sweep', () => {
  it('deletes only files older than a link can live, and no more than it is allowed', async () => {
    const { objects } = setup();
    for (const k of ['a', 'b', 'c']) await objects.put(k, new Uint8Array([1]), 'text/csv');

    expect(await objects.purge(purgeBefore('2026-09-23T08:59:59.000Z'), 10)).toBe(0);
    expect(await objects.purge(purgeBefore('2026-09-23T09:00:01.000Z'), 2)).toBe(2);
    expect(await objects.purge(purgeBefore('2026-09-23T09:00:01.000Z'), 2)).toBe(1);
    expect(objects.raw('c')).toBeUndefined();
  });
});

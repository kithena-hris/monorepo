import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { fixedClock, type Clock, type PendingEvent } from '@kithena/domain-kit';

import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { asking, FINANCE, financeTenant, HR } from './fixture.js';
import { runExportJob, type ExportJobDeps, type ExportNotifier } from './job.js';
import { inMemoryExportLedger } from './ledger.js';
import { localObjectStore } from './object-store.js';
import { utcCalendars } from '../org/org.js';

/** A clock the test can move, as a day passes between the link and the click. */
function movableClock(start: string): Clock & { set(iso: string): void } {
  let current = fixedClock(start);
  return {
    instant: () => current.instant(),
    date: (tz) => current.date(tz),
    set(iso) {
      current = fixedClock(iso);
    },
  } as Clock & { set(iso: string): void };
}

function setup() {
  const store = financeTenant();
  const clock = movableClock('2026-09-22T09:00:00.000Z');
  const objects = localObjectStore({
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    clock,
    baseUrl: 'https://files.kithena.test/o',
  });
  const events: PendingEvent[] = [];
  const sent: Parameters<ExportNotifier['notify']>[0][] = [];
  let ids = 0;
  const deps: ExportJobDeps = {
    calendars: utcCalendars,
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    relations: store.deps.relations,
    records: store.deps,
    clock: store.deps.clock,
    store: objects,
    notifier: { notify: (m) => (sent.push(m), Promise.resolve()) },
    audit: { publish: (_tx, e) => (events.push(...e), Promise.resolve()) },
    ledger: inMemoryExportLedger(),
    newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
  };
  return { deps, objects, clock, events, sent };
}

describe('a financial export', () => {
  it('is refused without a stated reason, and nothing is stored, sent or audited', async () => {
    const { deps, events, sent } = setup();
    for (const reason of [undefined, null, '   ']) {
      const refused = await runExportJob(tx, deps, {
        ...asking(FINANCE),
        format: 'xlsx',
        ...(reason === undefined ? {} : { reason }),
      });
      expect(!refused.ok && refused.error.code).toBe('EXPORT_REASON_REQUIRED');
    }
    expect(events).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('runs with one, and the reason is recorded on the event with no values', async () => {
    const { deps, events } = setup();
    const done = await runExportJob(tx, deps, {
      ...asking(FINANCE),
      format: 'csv',
      reason: 'September payroll reconciliation',
    });
    expect(done.ok).toBe(true);
    expect(events.map((e) => e.eventName)).toEqual(['people.export.completed']);
    expect(events[0]?.payload).toMatchObject({
      rowCount: 3,
      format: 'csv',
      reason: 'September payroll reconciliation',
    });
    expect(events[0]?.actor).toEqual({ kind: 'user', userId: FINANCE.accountId });
    expect(JSON.stringify(events)).not.toMatch(/Ada|CC-1|55000|files\.kithena/u);
  });

  it('needs no reason when nothing financial is in it', async () => {
    const { deps } = setup();
    const done = await runExportJob(tx, deps, {
      ...asking(HR),
      format: 'csv',
      fields: ['given_name', 'job_title'],
    });
    expect(done.ok).toBe(true);
  });

  it('never carries a special-category field, whatever the reason', async () => {
    const { deps } = setup();
    const refused = await runExportJob(tx, deps, {
      ...asking(HR),
      format: 'csv',
      fields: ['health_notes'],
      reason: 'because',
    });
    expect(!refused.ok && refused.error.code).toBe('EXPORT_FIELD_REFUSED');
  });
});

describe('the delivered file', () => {
  it('is a link in a notification, encrypted at rest, that expires in 24 hours', async () => {
    const { deps, objects, clock, sent } = setup();
    const done = await runExportJob(tx, deps, { ...asking(HR), format: 'csv', reason: 'audit' });
    if (!done.ok) throw new Error(done.error.message);

    expect(done.value.expiresAt).toBe('2026-09-23T09:00:00.000Z');
    expect(sent).toEqual([
      expect.objectContaining({ recipientAccountId: HR.accountId, links: done.value.links }),
    ]);
    // A link, not an attachment: nothing in the notification is the file.
    expect(JSON.stringify(sent)).not.toContain('Grace');

    const url = done.value.links[0]?.url ?? '';
    const key = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
    expect(new TextDecoder().decode(objects.raw(key))).not.toContain('Grace');

    clock.set('2026-09-23T08:59:59.000Z');
    const opened = await objects.open(url);
    expect(opened.ok && new TextDecoder().decode(opened.value.bytes)).toContain('Grace');

    clock.set('2026-09-23T09:00:00.000Z');
    const expired = await objects.open(url);
    expect(!expired.ok && expired.error.code).toBe('LINK_EXPIRED');
  });

  it('refuses a link whose expiry was edited', async () => {
    const { deps, objects } = setup();
    const done = await runExportJob(tx, deps, { ...asking(HR), format: 'csv', reason: 'audit' });
    if (!done.ok) throw new Error(done.error.message);
    const url = new URL(done.value.links[0]?.url ?? '');
    url.searchParams.set('expires', '2099-01-01T00:00:00.000Z');
    const opened = await objects.open(url.toString());
    expect(!opened.ok && opened.error.code).toBe('LINK_INVALID');
  });
});

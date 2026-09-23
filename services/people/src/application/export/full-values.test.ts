import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { fixedClock, type Clock, type PendingEvent } from '@kithena/domain-kit';

import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { ADA, asking, FINANCE, financeTenant, HR, MANAGER } from './fixture.js';
import {
  claimDownload,
  decideFullValues,
  fullValuesOf,
  requestFullValues,
  settleFullValues,
  viewFullValues,
  type FullValuesDeps,
} from './full-values.js';
import { inMemoryFullValuesStore } from './full-values-store.js';
import { inMemoryExportLedger } from './ledger.js';
import { keyOf, localObjectStore } from './object-store.js';
import { utcCalendars } from '../org/org.js';

const IBAN = 'ES9121000418450200051332';
const FINANCE_TOO: Viewer = {
  accountId: '00000000-0000-4000-8000-0000000000fd',
  roles: new Set(['finance']),
};
const HR_AND_FINANCE: Viewer = { accountId: FINANCE.accountId, roles: new Set(['finance', 'hr']) };

function movableClock(start: string): Clock & { set(iso: string): void } {
  let current = fixedClock(start);
  return {
    now: () => current.now(),
    today: (tz: string) => current.today(tz),
    instant: () => current.instant(),
    date: (tz: string) => current.date(tz),
    set(iso: string) {
      current = fixedClock(iso);
    },
  };
}

function setup() {
  const people = financeTenant();
  const clock = movableClock('2026-09-22T09:00:00.000Z');
  const objects = localObjectStore({
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    clock,
    baseUrl: 'https://people.test/v1/exports/files',
  });
  const events: PendingEvent[] = [];
  const sent: string[] = [];
  const revealed: string[] = [];
  let ids = 0;
  const deps: FullValuesDeps = { calendars: utcCalendars,
    access: personAccess(people.deps),
    schemas: people.deps.schemas,
    relations: people.deps.relations,
    records: people.deps,
    clock,
    store: objects,
    notifier: {
      notify: (m) => {
        sent.push(...m.links.map((l) => l.url));
        return Promise.resolve();
      },
    },
    audit: { publish: (_tx, e) => (events.push(...e), Promise.resolve()) },
    ledger: inMemoryExportLedger(),
    newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
    requests: inMemoryFullValuesStore(),
    reveal: (_tx, where) => {
      revealed.push(`${where.personId}:${where.attributeKey}`);
      return Promise.resolve(people.secrets.get(`${where.personId}:${where.attributeKey}`) ?? null);
    },
  };
  return { deps, objects, clock, events, sent, revealed };
}

const ask = (deps: FullValuesDeps, viewer: Viewer = FINANCE, fields = ['iban', 'given_name']) =>
  requestFullValues(tx, deps, { ...asking(viewer), fields, reason: 'September payroll run' });

async function requested(deps: FullValuesDeps) {
  const r = await ask(deps);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.approval.id;
}

const settle = (deps: FullValuesDeps, requestId: string) =>
  settleFullValues(tx, deps, { tenantId: asking(HR).tenantId, requestId, correlationId: 'c' });

/** What the file route does: the link's signature first, then the one download. */
async function download(
  deps: FullValuesDeps,
  objects: ReturnType<typeof localObjectStore>,
  link: string,
) {
  const opened = await objects.open(link);
  if (!opened.ok) return opened;
  const owner = fullValuesOf(keyOf(link) ?? '');
  if (!owner) throw new Error('not a full-values key');
  const claimed = await claimDownload(tx, deps, { ...owner, correlationId: 'c' });
  return claimed.ok ? opened : claimed;
}

async function cells(bytes: Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as never);
  return JSON.stringify(wb.getWorksheet('People')?.getSheetValues());
}

describe('finance asks, HR approves, one download', () => {
  it('issues exactly one file, with the asked-for sealed field in full, downloadable once', async () => {
    const { deps, objects, sent, revealed } = setup();
    const id = await requested(deps);
    expect(await settle(deps, id)).toEqual({ ok: true, value: 'pending' });
    expect(sent).toHaveLength(0);

    const approved = await decideFullValues(tx, deps, {
      ...asking(HR),
      requestId: id,
      approve: true,
    });
    expect(approved.ok).toBe(true);
    expect(await settle(deps, id)).toEqual({ ok: true, value: 'issued' });
    expect(await settle(deps, id)).toEqual({ ok: true, value: 'issued' });
    expect(sent).toHaveLength(1);
    expect(revealed).toEqual([`${ADA}:iban`]);

    const first = await download(deps, objects, sent[0] ?? '');
    if (!first.ok) throw new Error(first.error.message);
    expect(await cells(first.value.bytes)).toContain(IBAN);

    const second = await download(deps, objects, sent[0] ?? '');
    expect(!second.ok && second.error.code).toBe('GRANT_USED');

    const view = await viewFullValues(tx, deps, { ...asking(FINANCE), requestId: id });
    expect(view.ok && view.value).toMatchObject({ state: 'downloaded', link: null });
  });

  it('carries only the fields asked for: an approval is not a licence for the register', async () => {
    const { deps, objects, sent } = setup();
    const id = await requested(deps);
    await decideFullValues(tx, deps, { ...asking(HR), requestId: id, approve: true });
    await settle(deps, id);
    const opened = await download(deps, objects, sent[0] ?? '');
    if (!opened.ok) throw new Error(opened.error.message);
    const file = await cells(opened.value.bytes);
    expect(file).toContain('IBAN');
    expect(file).not.toContain('Base salary');
    expect(file).not.toContain('never exported');
  });

  it('cannot be downloaded after 24 hours, even unused', async () => {
    const { deps, objects, clock, sent } = setup();
    const id = await requested(deps);
    await decideFullValues(tx, deps, { ...asking(HR), requestId: id, approve: true });
    await settle(deps, id);
    clock.set('2026-09-23T09:00:00.000Z');
    const late = await download(deps, objects, sent[0] ?? '');
    expect(!late.ok && late.error.code).toBe('LINK_EXPIRED');
  });
});

describe('a rejection', () => {
  it('issues nothing and reveals nothing', async () => {
    const { deps, events, sent, revealed } = setup();
    const id = await requested(deps);
    const rejected = await decideFullValues(tx, deps, {
      ...asking(HR),
      requestId: id,
      approve: false,
      note: 'Use the payroll bureau feed',
    });
    expect(rejected.ok).toBe(true);
    expect(await settle(deps, id)).toEqual({ ok: true, value: 'rejected' });
    expect(sent).toHaveLength(0);
    expect(revealed).toHaveLength(0);
    expect(events.map((e) => e.eventName)).toEqual([
      'people.export.full_values_requested',
      'people.export.full_values_decided',
    ]);
    const again = await decideFullValues(tx, deps, { ...asking(HR), requestId: id, approve: true });
    expect(!again.ok && again.error.code).toBe('APPROVAL_DECIDED');
  });
});

describe('an undecided request', () => {
  it('expires after seven days, is recorded once, and can no longer be approved', async () => {
    const { deps, clock, events, sent } = setup();
    const id = await requested(deps);
    clock.set('2026-09-29T08:59:59.000Z');
    expect(await settle(deps, id)).toEqual({ ok: true, value: 'pending' });

    clock.set('2026-09-29T09:00:00.000Z');
    expect(await settle(deps, id)).toEqual({ ok: true, value: 'expired' });
    expect(await settle(deps, id)).toEqual({ ok: true, value: 'expired' });
    expect(events.filter((e) => e.eventName === 'people.export.full_values_expired')).toHaveLength(
      1,
    );

    const late = await decideFullValues(tx, deps, { ...asking(HR), requestId: id, approve: true });
    expect(!late.ok && late.error.code).toBe('APPROVAL_EXPIRED');
    expect(sent).toHaveLength(0);
  });
});

describe('who may do what', () => {
  it('refuses a request from anyone but finance', async () => {
    const { deps } = setup();
    for (const viewer of [HR, MANAGER]) {
      const refused = await ask(deps, viewer);
      expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    }
  });

  it('refuses a decision from anyone but HR, and from the requester whatever their roles', async () => {
    const { deps } = setup();
    const own = await requestFullValues(tx, deps, {
      ...asking(HR_AND_FINANCE),
      fields: ['iban'],
      reason: 'r',
    });
    if (!own.ok) throw new Error(own.error.message);
    for (const viewer of [FINANCE_TOO, MANAGER]) {
      const refused = await decideFullValues(tx, deps, {
        ...asking(viewer),
        requestId: own.value.approval.id,
        approve: true,
      });
      expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    }
    const self = await decideFullValues(tx, deps, {
      ...asking(HR_AND_FINANCE),
      requestId: own.value.approval.id,
      approve: true,
    });
    expect(!self.ok && self.error.code).toBe('FORBIDDEN');
  });

  it('refuses special-category data, approved or not, and a request with no reason', async () => {
    const { deps } = setup();
    const special = await ask(deps, FINANCE, ['iban', 'health_notes']);
    expect(!special.ok && special.error.code).toBe('EXPORT_FIELD_REFUSED');
    const unreasoned = await requestFullValues(tx, deps, {
      ...asking(FINANCE),
      fields: ['iban'],
      reason: ' ',
    });
    expect(!unreasoned.ok && unreasoned.error.code).toBe('REASON_REQUIRED');
    const nothingSealed = await ask(deps, FINANCE, ['given_name']);
    expect(!nothingSealed.ok && nothingSealed.error.code).toBe('NOTHING_SEALED');
  });
});

describe('the audit trail', () => {
  it('names the actor, the reason and the keys at every step, and never a value or a link', async () => {
    const { deps, objects, events, sent } = setup();
    const id = await requested(deps);
    await decideFullValues(tx, deps, { ...asking(HR), requestId: id, approve: true, note: 'ok' });
    await settle(deps, id);
    await download(deps, objects, sent[0] ?? '');

    expect(events.map((e) => [e.eventName, e.actor])).toEqual([
      ['people.export.full_values_requested', { kind: 'user', userId: FINANCE.accountId }],
      ['people.export.full_values_decided', { kind: 'user', userId: HR.accountId }],
      ['people.export.full_values_issued', { kind: 'system', process: 'people-full-values' }],
      ['people.export.completed', { kind: 'user', userId: FINANCE.accountId }],
      ['people.export.full_values_downloaded', { kind: 'system', process: 'people-full-values' }],
    ]);
    expect(events[0]?.payload).toMatchObject({
      reason: 'September payroll run',
      attributeKeys: ['iban', 'given_name'],
    });
    expect(events[1]?.payload).toMatchObject({
      decision: 'approved',
      reason: 'September payroll run',
      note: 'ok',
    });
    expect(events[4]?.payload).toMatchObject({ issuedTo: FINANCE.accountId });
    const all = JSON.stringify(events);
    expect(all).not.toContain(IBAN);
    expect(all).not.toContain('people.test');
    expect(all).not.toContain('Ada');
  });
});

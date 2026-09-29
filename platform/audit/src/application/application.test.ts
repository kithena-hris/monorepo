import { describe, expect, it } from 'vitest';

import type { Entry } from '../domain/entry.js';
import type { Filter } from '../domain/reading.js';
import type { EntryStore, StoredEntry } from './ports.js';
import { readActivity } from './read.js';
import { recordEvent } from './record.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const ADA = '00000000-0000-4000-8000-0000000000a1';

function memoryStore(): EntryStore & { readonly rows: StoredEntry[] } {
  const rows: StoredEntry[] = [];
  return {
    rows,
    append(entry: Entry) {
      if (rows.some((r) => r.sourceEventId === entry.sourceEventId)) return Promise.resolve(false);
      rows.unshift({ ...entry, id: `e${String(rows.length).padStart(3, '0')}`, supportSignIn: null });
      return Promise.resolve(true);
    },
    page(_tenantId, { before, limit }) {
      const from = before === null ? 0 : rows.findIndex((r) => r.id === before) + 1;
      return Promise.resolve(rows.slice(from, from + limit));
    },
  };
}

const envelope = (eventId: string, over: Record<string, unknown> = {}) => ({
  eventId,
  eventName: 'people.settings.activity_recorded',
  eventVersion: 1,
  tenantId: TENANT,
  occurredAt: '2026-09-29T10:00:00.000Z',
  recordedAt: '2026-09-29T10:00:01.000Z',
  effectiveFrom: null,
  aggregate: { type: 'SettingsActivity', id: eventId, version: 1 },
  actor: { kind: 'user', userId: ADA },
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  causationId: null,
  payload: { area: 'roles', action: 'Granted a role', subject: 'HR', detail: null, reason: null },
  ...over,
});

const ALL: Filter = {
  areas: [],
  actorKind: null,
  actor: null,
  subject: null,
  from: null,
  until: null,
  search: null,
};

describe('recording an event', () => {
  it('keeps it once however often it arrives', async () => {
    const store = memoryStore();
    const record = recordEvent({ store });
    const id = '01890000-0000-7000-8000-000000000001';
    expect(await record(envelope(id))).toBe('recorded');
    expect(await record(envelope(id))).toBe('duplicate');
    expect(store.rows).toHaveLength(1);
  });

  it('ignores events the log does not keep, and refuses one that breaks its contract', async () => {
    const rejected: string[] = [];
    const record = recordEvent({
      store: memoryStore(),
      onRejected: (name) => rejected.push(name),
    });
    expect(
      await record(envelope('01890000-0000-7000-8000-000000000002', { eventName: 'people.person.hired' })),
    ).toBe('ignored');
    expect(
      await record(envelope('01890000-0000-7000-8000-000000000003', { payload: { area: 'payroll' } })),
    ).toBe('rejected');
    expect(await record('not an envelope')).toBe('ignored');
    expect(rejected).toEqual(['people.settings.activity_recorded']);
  });
});

describe('reading the log', () => {
  const seeded = async (n: number) => {
    const store = memoryStore();
    const record = recordEvent({ store });
    for (let i = 0; i < n; i += 1) {
      await record(envelope(`01890000-0000-7000-8000-${String(i).padStart(12, '0')}`));
    }
    return store;
  };
  const roles = (held: string[]) => ({ roles: () => Promise.resolve(new Set(held)) });
  const asking = { tenantId: TENANT, accountId: ADA, supportOperator: null };

  it('refuses anybody who is not a People administrator or HR', async () => {
    const read = readActivity({ store: await seeded(1), readers: roles(['finance']) });
    const answer = await read(asking, { filter: ALL, before: null });
    expect(answer.ok ? null : answer.error.code).toBe('FORBIDDEN');
  });

  it('lets Kithena support read without asking OpenFGA', async () => {
    const read = readActivity({
      store: await seeded(1),
      readers: { roles: () => Promise.reject(new Error('support holds no tuple')) },
    });
    const answer = await read(
      { ...asking, supportOperator: '00000000-0000-4000-8000-0000000000f1' },
      { filter: ALL, before: null },
    );
    expect(answer.ok).toBe(true);
  });

  it('pages newest first, fifty at a time, with a cursor to the older ones', async () => {
    const read = readActivity({ store: await seeded(51), readers: roles(['hr']) });
    const first = await read(asking, { filter: ALL, before: null });
    if (!first.ok) throw new Error('refused');
    expect(first.value.entries).toHaveLength(50);
    expect(first.value.next).toBe(first.value.entries.at(-1)?.id);
    const older = await read(asking, { filter: ALL, before: first.value.next });
    if (!older.ok) throw new Error('refused');
    expect(older.value.entries).toHaveLength(1);
    expect(older.value.next).toBeNull();
  });
});

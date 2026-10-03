import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { err, failure, fixedClock, ok, type PendingEvent } from '@kithena/domain-kit';

import type { ImportRun } from '../../domain/import/run.js';
import { localObjectStore } from '../export/object-store.js';
import {
  applyChunk,
  approveImport,
  stepRun,
  type ApproveDeps,
  type RunDeps,
  type RunStore,
  type RunWork,
  type StoredRun,
} from './run.js';

/**
 * Approve and run, below the transports, over fakes: what approving checks,
 * and the run's chunks — each applied once, a replay refused, a chunk that
 * throws rolled back and done again, a refusal stopping the run with its
 * reason and keeping what was done.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ADA = { accountId: '00000000-0000-4000-8000-0000000000a1', roles: new Set(['hr']) };
const GRACE = { accountId: '00000000-0000-4000-8000-0000000000a2', roles: new Set(['hr']) };
const UPLOAD = '00000000-0000-4000-8000-0000000000f1';
const clock = fixedClock('2026-10-03T14:02:00.000Z');
const asking = (viewer = ADA) => ({ tenantId: TENANT, viewer, correlationId: 'c-1' });
const input = { uploadId: UPLOAD, mapping: {}, proposals: [] };

/** Runs in a map; a transaction is a copy of it, written back only when it commits. */
function store() {
  let rows = new Map<string, StoredRun>();
  const runs: RunStore = {
    insert: (_tx, run) => {
      if ([...rows.values()].some((r) => r.status === 'queued' || r.status === 'running')) {
        return Promise.resolve(false);
      }
      rows.set(run.id, run);
      return Promise.resolve(true);
    },
    find: (_tx, _t, id) => Promise.resolve(rows.get(id) ?? null),
    save: (_tx, _t, run) => {
      const was = rows.get(run.id);
      if (was !== undefined) rows.set(run.id, { ...was, ...run });
      return Promise.resolve();
    },
    active: () =>
      Promise.resolve(
        [...rows.values()].find((r) => r.status === 'queued' || r.status === 'running') ?? null,
      ),
    finished: () => Promise.resolve([]),
    imported: () => Promise.resolve(false),
  };
  const atomically: RunDeps['atomically'] = async (_tenantId, fn) => {
    const before = new Map(rows);
    try {
      const result = await fn({} as never);
      if (!result.ok) rows = before;
      return result;
    } catch (cause) {
      rows = before;
      throw cause;
    }
  };
  return { runs, atomically, all: () => [...rows.values()] };
}

function world(options: { published?: number | null; hr?: boolean } = {}) {
  const s = store();
  const sealed = localObjectStore({
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    clock,
    baseUrl: 'https://people.test/f',
  });
  let ids = 0;
  const approve: ApproveDeps = {
    service: {
      inTenant: (_t: string, fn: (s: { tx: never }) => unknown) => fn({ tx: {} as never }),
    } as never,
    relations: {
      relations: () =>
        Promise.resolve({
          isSelf: false,
          isManager: false,
          isInManagerChain: false,
          isHr: options.hr ?? true,
          isFinance: false,
          isAdmin: false,
        }),
    },
    schema: {
      currentVersion: () =>
        Promise.resolve(options.published === null ? null : { version: options.published ?? 3 }),
    } as never,
    uploads: {
      intents: {
        find: (_tx: unknown, _t: string, id: string) =>
          Promise.resolve({
            id,
            tenantId: TENANT,
            // Ada's upload, and Grace's second one.
            actorId: id.endsWith('f2') ? GRACE.accountId : ADA.accountId,
            purpose: 'import',
            name: 'people.csv',
            size: 10,
            objectKey: `${TENANT}/import/${id}`,
            createdAt: '2026-10-03T13:00:00.000Z',
            urlExpiresAt: '2026-10-03T13:05:00.000Z',
            expiresAt: '2026-10-04T13:00:00.000Z',
            checksum: 'a'.repeat(64),
          }),
      },
    } as never,
    runs: s.runs,
    clock,
    newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
    sealed,
  };
  // The work: what each chunk was asked for, and a script of how it answers.
  const asked: string[] = [];
  const events: PendingEvent[] = [];
  const over: ImportRun['status'][] = [];
  let script: (what: string) => 'ok' | 'throw' | 'refuse' = () => 'ok';
  const answer = <T>(what: string, value: T) => {
    asked.push(what);
    const how = script(what);
    if (how === 'throw') return Promise.reject(new Error('the database went away'));
    if (how === 'refuse')
      return Promise.resolve(err(failure('DEFINITION_INVALID', 'Shoe size: refused')));
    return Promise.resolve(ok(value));
  };
  const work: RunWork = {
    setup: () => answer('setup', { fields: 2 }),
    read: () => answer('read', { total: 120 }),
    rows: (_tx, _ctx, phase, from, to) =>
      answer(
        `${phase} ${String(from)}-${String(to)}`,
        phase === 'people' ? { created: to - from } : {},
      ),
    finish: () => answer('finish', null),
    over: (_ctx, run) => {
      over.push(run.status);
      return Promise.resolve();
    },
  };
  const run: RunDeps = {
    runs: s.runs,
    clock,
    newId: approve.newId,
    sealed,
    atomically: s.atomically,
    work,
    publish: (_tx, e) => {
      events.push(...e);
      return Promise.resolve();
    },
  };
  return {
    approve,
    run,
    asked,
    events,
    over,
    rows: s.all,
    script: (fn: typeof script) => {
      script = fn;
    },
  };
}

const toEnd = async (w: ReturnType<typeof world>, runId: string) => {
  for (let i = 0; i < 100; i += 1) {
    if ((await stepRun(w.run, TENANT, runId)) === 'done') return;
  }
  throw new Error('never finished');
};

describe('approving an import', () => {
  it('records a queued run and answers with it at once', async () => {
    const w = world();
    const approved = await approveImport(w.approve, asking(), { ...input, basedOn: 3 });
    expect(approved).toMatchObject({ ok: true, value: { status: 'queued' } });
    expect(w.rows()).toMatchObject([
      { status: 'queued', phase: 'setup', actorId: ADA.accountId, name: 'people.csv' },
    ]);
    // Nothing of the import has run yet.
    expect(w.asked).toEqual([]);
  });

  it('allows one run per company: a second approval is refused while one is going', async () => {
    const w = world();
    const first = await approveImport(w.approve, asking(), input);
    if (!first.ok) throw new Error(first.error.message);
    const second = await approveImport(w.approve, asking(GRACE), {
      ...input,
      uploadId: '00000000-0000-4000-8000-0000000000f2',
    });
    expect(second).toMatchObject({
      ok: false,
      error: {
        code: 'IMPORT_RUNNING',
        link: `/people/import?run=${first.value.runId}`,
      },
    });
    expect(w.rows()).toHaveLength(1);
    // Once it is over, the next one goes.
    await toEnd(w, first.value.runId);
    expect(await approveImport(w.approve, asking(), input)).toMatchObject({ ok: true });
  });

  it('refuses a plan made against a version since replaced, and anybody but HR', async () => {
    const w = world({ published: 4 });
    expect(await approveImport(w.approve, asking(), { ...input, basedOn: 3 })).toMatchObject({
      ok: false,
      error: { code: 'STALE_PLAN' },
    });
    expect(await approveImport(world({ hr: false }).approve, asking(), input)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    // Somebody else's upload is not found, never forbidden.
    expect(await approveImport(w.approve, asking(GRACE), input)).toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_NOT_FOUND' },
    });
  });
});

describe('running it, chunk by chunk', () => {
  it('runs every chunk once, in order, to Imported', async () => {
    const w = world();
    const approved = await approveImport(w.approve, asking(), input);
    if (!approved.ok) throw new Error(approved.error.message);
    await toEnd(w, approved.value.runId);
    expect(w.asked).toEqual([
      'setup',
      'read',
      'people 0-50',
      'people 50-100',
      'people 100-120',
      'managers 0-50',
      'managers 50-100',
      'managers 100-120',
      'lifecycle 0-50',
      'lifecycle 50-100',
      'lifecycle 100-120',
      'finish',
    ]);
    expect(w.rows()[0]).toMatchObject({
      status: 'succeeded',
      fields: 2,
      total: 120,
      counts: { created: 120 },
    });
    expect(w.over).toEqual(['succeeded']);
  });

  it('applies a chunk only while it is the next: a replay after a restart writes nothing', async () => {
    const w = world();
    const approved = await approveImport(w.approve, asking(), input);
    if (!approved.ok) throw new Error(approved.error.message);
    const id = approved.value.runId;
    for (let i = 0; i < 3; i += 1) await stepRun(w.run, TENANT, id); // setup, read, people 0-50
    const ctx = {
      run: w.rows()[0] as StoredRun,
      asking: asking(),
      input: { ...input, applySensitiveWithoutApproval: true },
    };
    const replay = await applyChunk(w.run, ctx, { kind: 'rows', phase: 'people', from: 0, to: 50 });
    expect(replay).toEqual({ ok: true, value: null });
    expect(w.asked.filter((a) => a === 'people 0-50')).toHaveLength(1);
    expect(w.rows()[0]).toMatchObject({ phase: 'people', done: 50, counts: { created: 50 } });
  });

  it('rolls a chunk that throws back, progress and all, and does it again on the next step', async () => {
    const w = world();
    const approved = await approveImport(w.approve, asking(), input);
    if (!approved.ok) throw new Error(approved.error.message);
    const id = approved.value.runId;
    let once = true;
    w.script((what) => {
      if (what === 'people 50-100' && once) {
        once = false;
        return 'throw';
      }
      return 'ok';
    });
    for (let i = 0; i < 3; i += 1) await stepRun(w.run, TENANT, id);
    await expect(stepRun(w.run, TENANT, id)).rejects.toThrow('the database went away');
    expect(w.rows()[0]).toMatchObject({ status: 'running', phase: 'people', done: 50 });
    await toEnd(w, id);
    expect(w.asked.filter((a) => a === 'people 50-100')).toHaveLength(2);
    // Counted once: the attempt that threw left nothing behind.
    expect(w.rows()[0]).toMatchObject({ status: 'succeeded', counts: { created: 120 } });
  });

  it('stops on a refusal with its reason, keeping what was done, and says so on the outbox', async () => {
    const w = world();
    const approved = await approveImport(w.approve, asking(), input);
    if (!approved.ok) throw new Error(approved.error.message);
    const id = approved.value.runId;
    w.script((what) => (what === 'people 100-120' ? 'refuse' : 'ok'));
    await toEnd(w, id);
    expect(w.rows()[0]).toMatchObject({
      status: 'failed',
      done: 100,
      counts: { created: 100 },
      failure:
        'Shoe size: refused. 100 of 120 people were imported before it stopped; they stay. Upload the file again to import the rest: people already imported are matched, never added twice.',
    });
    expect(
      w.events.map((e) => [e.eventName, (e.payload as { importId: string }).importId]),
    ).toEqual([['people.import.failed', id]]);
    expect(w.over).toEqual(['failed']);
    // Over is over: nothing more runs.
    expect(await stepRun(w.run, TENANT, id)).toBe('done');
  });
});

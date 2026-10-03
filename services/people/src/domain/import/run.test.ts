import { describe, expect, it } from 'vitest';

import {
  afterChunk,
  begun,
  failRun,
  isActive,
  nextChunk,
  peopleDone,
  queuedRun,
  runFailure,
  stepLabel,
  type ImportRun,
} from './run.js';

/**
 * An approved import, run in chunks (docs/ai-settings.md): setup, reading the
 * file, people a batch at a time, their managers, their employment status,
 * then the result. Each chunk is named by where the run stands, so a chunk
 * replayed after a restart is recognised and refused rather than run twice.
 */

const AT = '2026-10-03T14:02:00.000Z';
const run0 = queuedRun('r-1');

/** Run every chunk to the end, as a worker would; `total` rows in the file. */
function toEnd(total: number, batch = 50): { run: ImportRun; chunks: string[] } {
  let run = begun(run0, AT);
  const chunks: string[] = [];
  for (let chunk = nextChunk(run, batch); chunk !== null; chunk = nextChunk(run, batch)) {
    chunks.push(chunk.kind === 'rows' ? `${chunk.phase} ${String(chunk.from)}-${String(chunk.to)}` : chunk.kind);
    const next = afterChunk(run, chunk, AT, chunk.kind === 'read' ? { total } : {});
    if (!next.ok) throw new Error(next.error.message);
    run = next.value;
  }
  return { run, chunks };
}

describe('an import run', () => {
  it('is queued, then running once a worker picks it up; both are active', () => {
    expect(run0).toMatchObject({ status: 'queued', phase: 'setup', done: 0, total: null });
    const running = begun(run0, AT);
    expect(running).toMatchObject({ status: 'running', startedAt: AT });
    expect(isActive(run0.status) && isActive(running.status)).toBe(true);
    // Picking it up again (a restart) keeps when it first started.
    expect(begun(running, '2026-10-03T15:00:00.000Z').startedAt).toBe(AT);
  });

  it('goes setup, read, people in batches, managers, lifecycle, finish, then succeeded', () => {
    const { run, chunks } = toEnd(120);
    expect(chunks).toEqual([
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
    expect(run).toMatchObject({ status: 'succeeded', finishedAt: AT, total: 120 });
    expect(isActive(run.status)).toBe(false);
    expect(nextChunk(run)).toBeNull();
  });

  it('goes straight to finishing for a file with no rows', () => {
    expect(toEnd(0).chunks).toEqual(['setup', 'read', 'finish']);
  });

  it('refuses a chunk that is not the next one: a replay after a restart writes nothing', () => {
    let run = begun(run0, AT);
    const setup = nextChunk(run);
    if (setup === null) throw new Error('no chunk');
    const after = afterChunk(run, setup, AT);
    if (!after.ok) throw new Error(after.error.message);
    run = after.value;
    // The worker died after the setup committed and asks to run it again.
    expect(afterChunk(run, setup, AT)).toMatchObject({ ok: false, error: { code: 'STALE_CHUNK' } });
    const read = afterChunk(run, { kind: 'read' }, AT, { total: 10 });
    if (!read.ok) throw new Error(read.error.message);
    const batch = { kind: 'rows', phase: 'people', from: 0, to: 10 } as const;
    const once = afterChunk(read.value, batch, AT, { tally: { created: 10 } });
    if (!once.ok) throw new Error(once.error.message);
    expect(afterChunk(once.value, batch, AT, { tally: { created: 10 } })).toMatchObject({
      ok: false,
      error: { code: 'STALE_CHUNK' },
    });
    // Counted once, and the people are all done.
    expect(once.value.counts.created).toBe(10);
    expect(peopleDone(once.value)).toEqual({ done: 10, total: 10 });
  });

  it('adds each batch’s tallies to the run’s', () => {
    let run = begun(run0, AT);
    for (const [chunk, outcome] of [
      [{ kind: 'setup' }, {}],
      [{ kind: 'read' }, { total: 3 }],
      [{ kind: 'rows', phase: 'people', from: 0, to: 2 }, { tally: { created: 1, blocked: 1 } }],
      [{ kind: 'rows', phase: 'people', from: 2, to: 3 }, { tally: { updated: 1 } }],
    ] as const) {
      const next = afterChunk(run, chunk, AT, outcome);
      if (!next.ok) throw new Error(next.error.message);
      run = next.value;
    }
    expect(run.counts).toEqual({
      created: 1,
      updated: 1,
      unchanged: 0,
      blocked: 1,
      duplicate: 0,
      incomplete: 0,
    });
    expect(run).toMatchObject({ phase: 'managers', done: 0 });
  });

  it('fails with its reason, keeping what was done; a finished run neither fails nor moves', () => {
    const half = afterChunk(
      afterChunk(begun(run0, AT), { kind: 'setup' }, AT).value as ImportRun,
      { kind: 'read' },
      AT,
      { total: 100 },
    ).value as ImportRun;
    const people = afterChunk(half, { kind: 'rows', phase: 'people', from: 0, to: 50 }, AT, {
      tally: { created: 50 },
    }).value as ImportRun;
    const failed = failRun(people, 'Postgres is unreachable', AT);
    expect(failed).toMatchObject({
      ok: true,
      value: { status: 'failed', failure: 'Postgres is unreachable', finishedAt: AT, done: 50 },
    });
    if (!failed.ok) return;
    expect(failed.value.counts.created).toBe(50);
    expect(nextChunk(failed.value)).toBeNull();
    expect(failRun(failed.value, 'again', AT)).toMatchObject({ ok: false });
    expect(afterChunk(toEnd(3).run, { kind: 'finish' }, AT)).toMatchObject({ ok: false });
  });

  it('says where it stands in words', () => {
    expect(stepLabel('setup')).toBe('Setting up the fields');
    expect(stepLabel('people')).toBe('Adding people');
    expect(stepLabel('managers')).toBe('Linking managers');
    expect(stepLabel('lifecycle')).toBe('Setting employment status');
    expect(stepLabel('finishing')).toBe('Finishing');
  });

  it('says what a failure leaves behind and what to do', () => {
    expect(runFailure('The database did not answer', { done: 312, total: 1000 })).toBe(
      'The database did not answer. 312 of 1,000 people were imported before it stopped; they stay. Upload the file again to import the rest: people already imported are matched, never added twice.',
    );
    expect(runFailure('A field was refused', { done: 0, total: null })).toBe(
      'A field was refused. Nobody was imported. Fix it and upload the file again.',
    );
  });
});

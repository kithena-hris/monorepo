import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * An approved import, run in the background in chunks (docs/ai-settings.md,
 * "Approve and run").
 *
 * The run is worked through in order: **setup** (the company's fields, work
 * locations and numbering, one publish), **read** (the file, classified
 * against what is now published), then **people**, **managers** and
 * **lifecycle** a batch of rows at a time, then **finish** (the import's
 * ledger, its events, its report and the result).
 *
 * The next chunk is always worked out from where the run stands, and a chunk
 * is applied only when it is that chunk: so a worker that died after a chunk
 * committed, and is asked to run it again, is refused (`STALE_CHUNK`) rather
 * than writing anybody twice. The application commits a chunk's writes and
 * the run this returns in one transaction.
 */

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type RunPhase = 'setup' | 'people' | 'managers' | 'lifecycle' | 'finishing';
export type RowPhase = 'people' | 'managers' | 'lifecycle';

export interface RunCounts {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly blocked: number;
  readonly duplicate: number;
  readonly incomplete: number;
}

export interface ImportRun {
  readonly id: string;
  readonly status: RunStatus;
  readonly phase: RunPhase;
  /** Rows done in the current phase. */
  readonly done: number;
  /** Rows in the file, once it is read. */
  readonly total: number | null;
  readonly counts: RunCounts;
  readonly failure: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export type Chunk =
  | { readonly kind: 'setup' }
  | { readonly kind: 'read' }
  | { readonly kind: 'rows'; readonly phase: RowPhase; readonly from: number; readonly to: number }
  | { readonly kind: 'finish' };

/** Rows a chunk writes: each chunk is one transaction, a few seconds long. */
export const BATCH = 50;

export const NO_COUNTS: RunCounts = {
  created: 0,
  updated: 0,
  unchanged: 0,
  blocked: 0,
  duplicate: 0,
  incomplete: 0,
};

export const isActive = (status: RunStatus): boolean =>
  status === 'queued' || status === 'running';

export const queuedRun = (id: string): ImportRun => ({
  id,
  status: 'queued',
  phase: 'setup',
  done: 0,
  total: null,
  counts: NO_COUNTS,
  failure: null,
  startedAt: null,
  finishedAt: null,
});

/** A worker picked it up; picked up again after a restart, it keeps its start. */
export const begun = (run: ImportRun, at: string): ImportRun =>
  run.status === 'queued' ? { ...run, status: 'running', startedAt: run.startedAt ?? at } : run;

const ROW_PHASES: readonly RowPhase[] = ['people', 'managers', 'lifecycle'];

/** The chunk to run next, or null once the run has finished. */
export function nextChunk(run: ImportRun, batch: number = BATCH): Chunk | null {
  if (!isActive(run.status)) return null;
  if (run.phase === 'setup') return { kind: 'setup' };
  if (run.phase === 'finishing') return { kind: 'finish' };
  if (run.total === null) return { kind: 'read' };
  return { kind: 'rows', phase: run.phase, from: run.done, to: Math.min(run.total, run.done + batch) };
}

const same = (a: Chunk, b: Chunk): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'rows' || (b.kind === 'rows' && a.phase === b.phase && a.from === b.from && a.to === b.to));

/** The first phase from `phase` on with rows left to do: an empty file goes straight to finishing. */
function onward(phase: RunPhase, done: number, total: number): Pick<ImportRun, 'phase' | 'done'> {
  if (phase === 'setup' || phase === 'finishing' || done < total) return { phase, done };
  const after = ROW_PHASES[ROW_PHASES.indexOf(phase) + 1];
  return after === undefined ? { phase: 'finishing', done: 0 } : onward(after, 0, total);
}

const add = (a: RunCounts, b: Partial<RunCounts>): RunCounts => ({
  created: a.created + (b.created ?? 0),
  updated: a.updated + (b.updated ?? 0),
  unchanged: a.unchanged + (b.unchanged ?? 0),
  blocked: a.blocked + (b.blocked ?? 0),
  duplicate: a.duplicate + (b.duplicate ?? 0),
  incomplete: a.incomplete + (b.incomplete ?? 0),
});

/**
 * The run once `chunk` has been done: `total` from reading the file, `tally`
 * from a batch of people. Refused unless `chunk` is the run's next one.
 */
export function afterChunk(
  run: ImportRun,
  chunk: Chunk,
  at: string,
  outcome: { readonly total?: number; readonly tally?: Partial<RunCounts> } = {},
): Result<ImportRun> {
  const expected = nextChunk(run, chunk.kind === 'rows' ? chunk.to - chunk.from : BATCH);
  if (expected === null || !same(expected, chunk)) {
    return err(failure('STALE_CHUNK', 'That part of the import is already done'));
  }
  switch (chunk.kind) {
    case 'setup':
      return ok({ ...run, phase: 'people', done: 0 });
    case 'read': {
      const total = Math.max(0, outcome.total ?? 0);
      return ok({ ...run, total, ...onward('people', 0, total) });
    }
    case 'rows':
      return ok({
        ...run,
        counts: chunk.phase === 'people' ? add(run.counts, outcome.tally ?? {}) : run.counts,
        ...onward(chunk.phase, chunk.to, run.total ?? 0),
      });
    case 'finish':
      return ok({ ...run, status: 'succeeded', finishedAt: at });
  }
}

/** Stopped, with its reason; what it finished stays done. */
export function failRun(run: ImportRun, reason: string, at: string): Result<ImportRun> {
  if (!isActive(run.status)) return err(failure('RUN_FINISHED', 'This import has already finished'));
  return ok({ ...run, status: 'failed', failure: reason, finishedAt: at });
}

/** How many people are in, of how many: the people phase's rows, all of them once past it. */
export function peopleDone(run: ImportRun): { readonly done: number; readonly total: number | null } {
  const total = run.total;
  if (total === null || run.phase === 'setup') return { done: 0, total };
  return { done: run.phase === 'people' ? run.done : total, total };
}

const STEPS: Readonly<Record<RunPhase, string>> = {
  setup: 'Setting up the fields',
  people: 'Adding people',
  managers: 'Linking managers',
  lifecycle: 'Setting employment status',
  finishing: 'Finishing',
};

/** Where a run stands, as the progress line says it. */
export const stepLabel = (phase: RunPhase): string => STEPS[phase];

const number = (n: number): string => n.toLocaleString('en-US');

/** Why a run stopped, what it left behind, and what to do now. */
export function runFailure(
  why: string,
  people: { readonly done: number; readonly total: number | null },
): string {
  const reason = why.trim().replace(/[.\s]+$/u, '');
  if (people.done === 0) {
    return `${reason}. Nobody was imported. Fix it and upload the file again.`;
  }
  const of = people.total === null ? '' : ` of ${number(people.total)}`;
  return `${reason}. ${number(people.done)}${of} people were imported before it stopped; they stay. Upload the file again to import the rest: people already imported are matched, never added twice.`;
}

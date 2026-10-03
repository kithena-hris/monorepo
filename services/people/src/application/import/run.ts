import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  err,
  failure,
  ok,
  type Clock,
  type DomainFailure,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { ImportFailed } from '@kithena/contracts';
import type * as z from 'zod';

import {
  BATCH,
  afterChunk,
  begun,
  failRun,
  isActive,
  labelOf,
  nextChunk,
  peopleDone,
  queuedRun,
  runFailure,
  stepLabel,
  type Chunk,
  type ImportRun,
  type RowPhase,
  type RunCounts,
  type RunLabel,
  type RunPhase,
} from '../../domain/import/run.js';
import {
  placeChoices,
  runViewOf,
  setUpImport,
  type ImportRunView,
  type NewFieldsDeps,
  type RunInput,
  type SetUp,
} from '../assistant/import-fields.js';
import type { ObjectStore } from '../export/object-store.js';
import type { Asking, Viewer } from '../person/ports.js';
import { run } from '../person/service.js';
import { actors } from '../screens/people.js';
import { NOBODY } from '../screens/record.js';
import { requestFromImport } from '../screens/requests.js';
import {
  commitInputOf,
  doneViewOf,
  importDeps,
  releaseUpload,
  type ImportDeps,
} from '../screens/operations.js';
import type { ActivityStore } from '../settings/activity-store.js';
import {
  countsOf,
  importStarted,
  linkRows,
  recordImport,
  resultKey,
  settleRows,
  writeRow,
  type CommitInput,
  type Outcome,
} from './commit.js';
import { dryRun, type DryRun, type LeftEmpty } from './dry-run.js';
import { planForKeyLookups } from './ledger.js';
import type { ImportNotice, RunStore, StoredRun } from './run-store.js';

export type { ImportNotice, RunStore, StoredRun } from './run-store.js';

/**
 * An approved import, run in the background (docs/ai-settings.md, "Approve
 * and run").
 *
 * A thousand people take minutes; a request may wait seconds. So approving
 * checks what can be checked at once — HR's rights, the upload, a plan made
 * against a version since replaced, the one run a company may have going —
 * records a run and answers with its id. A worker (`infrastructure/temporal/
 * import-run.ts`) then asks `stepRun` for one chunk after another until the
 * run is over, and the run's page reads `importRunView` as it goes.
 *
 * **Chunks.** Setup (the plan worked out again, the fields published), read
 * (the file classified against what is now published), people fifty at a
 * time, their managers, their employment status, then the record of the
 * import. Each chunk is one transaction holding the run's row locked, and
 * commits its writes and the run's progress together; a chunk that is no
 * longer the run's next (a worker died after committing it) writes nothing.
 * A restarted run carries on from the next chunk, so nobody is created twice.
 *
 * **Values stay sealed.** The run's row holds counts and words only. The
 * approved input, the classified rows and each batch's outcome hold values,
 * so they live sealed in the object store under `imports/` (the report's
 * week at most), and are deleted when the run is over. What the run did, the
 * done step's view, is kept there for its week and goes with an erasure.
 */

type Tx = PostgresJsDatabase;

/** What a chunk does, given the run's context; each runs inside the chunk's transaction. */
export interface RunWork {
  setup(tx: Tx, ctx: RunContext): Promise<Result<{ readonly fields: number }>>;
  read(tx: Tx, ctx: RunContext): Promise<Result<{ readonly total: number }>>;
  rows(
    tx: Tx,
    ctx: RunContext,
    phase: RowPhase,
    from: number,
    to: number,
  ): Promise<Result<Partial<RunCounts>>>;
  finish(tx: Tx, ctx: RunContext): Promise<Result<null>>;
  /** After the run is over, either way, outside any transaction: the working copies go. */
  over(ctx: RunContext, run: ImportRun): Promise<void>;
}

export interface RunContext {
  readonly run: StoredRun;
  /** The approver, as they approved it: the run writes as them. */
  readonly asking: Asking;
  readonly input: z.output<typeof RunInput>;
}

export interface RunDeps {
  readonly runs: RunStore;
  readonly clock: Clock;
  readonly newId: () => string;
  /** The sealed store: the approved input and the run's working copies. */
  readonly sealed: ObjectStore;
  /**
   * One tenant transaction that every unit of work opened inside it joins
   * (`sharing`), so a chunk's writes and the run's progress commit together.
   */
  readonly atomically: <T>(
    tenantId: string,
    fn: (tx: Tx) => Promise<Result<T>>,
  ) => Promise<Result<T>>;
  readonly work: RunWork;
  /** Into the outbox, in the caller's transaction: `people.import.failed`. */
  readonly publish: (tx: Tx, events: readonly PendingEvent[]) => Promise<void>;
}

/* ---------------------------------------------------------- the store -- */

/** Where a run keeps what it must not put in a table. */
export const runKey = (tenantId: string, runId: string, name: string): string =>
  `imports/${tenantId}/runs/${runId}/${name}.json`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function putSealed(store: ObjectStore, key: string, value: unknown): Promise<void> {
  await store.put(key, encoder.encode(JSON.stringify(value)), 'application/json');
}

/** A sealed object, or null when it is not there. The store opens only by link, so one is made. */
export async function getSealed<T>(
  store: ObjectStore,
  clock: Clock,
  key: string,
): Promise<T | null> {
  const link = await store.sign(key, new Date(Date.parse(clock.instant()) + 60_000).toISOString());
  const opened = await store.open(link);
  return opened.ok ? (JSON.parse(decoder.decode(opened.value.bytes)) as T) : null;
}

/** The approval, as the run reads it back. */
interface Approved {
  readonly input: z.output<typeof RunInput>;
  readonly viewer: Omit<Viewer, 'roles'> & { readonly roles: readonly string[] };
  readonly correlationId: string;
}

/* ------------------------------------------------------------ approve -- */

export interface ApproveDeps {
  readonly service: ImportDeps['service'];
  readonly relations: ImportDeps['relations'];
  readonly schema: NewFieldsDeps['schema'];
  readonly uploads: Pick<ImportDeps['uploads'], 'intents'>;
  readonly runs: RunStore;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly sealed: ObjectStore;
  readonly personOf?: ImportDeps['personOf'];
}

export interface Approval {
  readonly runId: string;
  readonly status: 'queued';
}

const ONLY_HR = () => err(failure('FORBIDDEN', 'Only HR imports people'));

/**
 * Approve and run: checked now, run in the background. Refused when the
 * viewer is not HR, the upload is not theirs or has expired, the file was
 * imported already, the plan was made against a version since replaced, or
 * the company has a run going. The caller starts the worker once this commits.
 */
export async function approveImport(
  deps: ApproveDeps,
  asking: Asking,
  input: z.output<typeof RunInput>,
): Promise<Result<Approval>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr) return ONLY_HR();
    const intent = await deps.uploads.intents.find(tx, asking.tenantId, input.uploadId);
    if (
      intent === null ||
      intent.actorId !== asking.viewer.accountId ||
      intent.purpose !== 'import'
    ) {
      return err(failure('UPLOAD_NOT_FOUND', 'No such upload; upload the file again'));
    }
    if (intent.checksum === null) {
      return err(failure('UPLOAD_NOT_FOUND', 'The upload did not finish; upload the file again'));
    }
    if (Date.parse(intent.expiresAt) <= Date.parse(deps.clock.instant())) {
      return err(failure('UPLOAD_EXPIRED', 'This upload has expired; upload the file again'));
    }
    if (await deps.runs.imported(tx, asking.tenantId, intent.checksum)) {
      return err(failure('ALREADY_IMPORTED', 'This exact file has already been imported'));
    }
    if (input.basedOn !== undefined) {
      const published = (await deps.schema.currentVersion(tx, asking.tenantId))?.version ?? null;
      if (published !== input.basedOn) {
        return err(
          failure(
            'STALE_PLAN',
            'The employee fields were published again since this plan was made. Review the plan again before approving it.',
          ),
        );
      }
    }
    const going = await deps.runs.active(tx, asking.tenantId);
    if (going !== null) return err(await running(deps, tx, asking, going));
    const runId = deps.newId();
    const stored: StoredRun = {
      ...queuedRun(runId),
      tenantId: asking.tenantId,
      uploadId: input.uploadId,
      actorId: asking.viewer.accountId,
      name: intent.name === '' ? null : intent.name,
      createdAt: deps.clock.instant(),
      checksum: null,
    };
    if (!(await deps.runs.insert(tx, stored))) {
      // Another approval won the race to the index.
      const winner = await deps.runs.active(tx, asking.tenantId);
      return err(
        winner === null
          ? failure('IMPORT_RUNNING', 'An import is already running in this company')
          : await running(deps, tx, asking, winner),
      );
    }
    const approved: Approved = {
      input,
      viewer: { ...asking.viewer, roles: [...asking.viewer.roles] },
      correlationId: asking.correlationId,
    };
    await putSealed(deps.sealed, runKey(asking.tenantId, runId, 'input'), approved);
    return ok({ runId, status: 'queued' as const });
  });
}

/** "An import is already running, started by Ada Lovelace", with where to watch it. */
async function running(
  deps: Naming,
  tx: Tx,
  asking: Asking,
  going: StoredRun,
): Promise<DomainFailure> {
  const by = await startedBy(deps, tx, asking, going.actorId);
  return {
    ...failure(
      'IMPORT_RUNNING',
      `An import is already running, started by ${by.you ? 'you' : by.name}. Only one import runs at a time.`,
    ),
    link: `/people/import?run=${going.id}`,
  };
}

/** Who can be named: People's records, through the same reads as the history. */
type Naming = Pick<ImportDeps, 'service'> & { readonly personOf?: ImportDeps['personOf'] };

async function startedBy(
  deps: Naming,
  tx: Tx,
  asking: Asking,
  actorId: string,
): Promise<{ readonly name: string; readonly you: boolean }> {
  if (actorId === asking.viewer.accountId) return { name: 'You', you: true };
  if (deps.personOf === undefined) {
    return { name: 'A colleague', you: false };
  }
  // Named as anybody would see them, as the history names people.
  const named = await actors(
    deps as unknown as ImportDeps,
    tx,
    { ...asking, viewer: { ...asking.viewer, accountId: NOBODY } },
    [{ kind: 'user', userId: actorId }],
  );
  return { name: named({ kind: 'user', userId: actorId }), you: false };
}

/* --------------------------------------------------------------- step -- */

/**
 * One chunk of the run, in its own transaction: 'more' while there is
 * another, 'done' once the run is over. A chunk refused by the import
 * (a field the settings refuse, an upload gone) fails the run with the
 * reason; anything else (the database, a deadlock) throws, for the worker
 * to retry, and the chunk's writes were rolled back with it.
 */
export async function stepRun(
  deps: RunDeps,
  tenantId: string,
  runId: string,
): Promise<'more' | 'done'> {
  const ctx = await contextOf(deps, tenantId, runId);
  if (ctx === null) return 'done';
  if (ctx === 'lost') {
    await stopRun(deps, tenantId, runId, 'The approved plan is no longer held');
    return 'done';
  }
  const chunk = nextChunk(begun(ctx.run, deps.clock.instant()));
  if (chunk === null) return 'done';
  const applied = await applyChunk(deps, ctx, chunk);
  if (!applied.ok) {
    await stopRun(deps, tenantId, runId, applied.error.message);
    return 'done';
  }
  if (applied.value !== null && !isActive(applied.value.status)) {
    await deps.work.over(ctx, applied.value);
    return 'done';
  }
  return 'more';
}

/** The run and its approval, as a chunk runs it; null once it is over, 'lost' without its input. */
async function contextOf(
  deps: RunDeps,
  tenantId: string,
  runId: string,
): Promise<RunContext | null | 'lost'> {
  const found = await deps.atomically(tenantId, async (tx) =>
    ok(await deps.runs.find(tx, tenantId, runId)),
  );
  if (!found.ok || found.value === null || !isActive(found.value.status)) return null;
  const approved = await getSealed<Approved>(
    deps.sealed,
    deps.clock,
    runKey(tenantId, runId, 'input'),
  );
  if (approved === null) return 'lost';
  return {
    run: found.value,
    input: approved.input,
    asking: {
      tenantId,
      viewer: { ...approved.viewer, roles: new Set(approved.viewer.roles) },
      correlationId: approved.correlationId,
    },
  };
}

/**
 * `chunk`, if it is still the run's next: its work and the run's progress in
 * one transaction, the run's row locked throughout. Null when it was not the
 * next (another attempt got there first): nothing was written.
 */
export async function applyChunk(
  deps: RunDeps,
  ctx: RunContext,
  chunk: Chunk,
): Promise<Result<ImportRun | null>> {
  const { tenantId } = ctx.asking;
  const outcome = await deps.atomically<{ applied: ImportRun | null }>(tenantId, async (tx) => {
    const locked = await deps.runs.find(tx, tenantId, ctx.run.id, true);
    if (locked === null || !isActive(locked.status)) return ok({ applied: null });
    const now = begun(locked, deps.clock.instant());
    const expected = nextChunk(now, chunk.kind === 'rows' ? chunk.to - chunk.from : undefined);
    if (expected === null || !sameChunk(expected, chunk)) return ok({ applied: null });
    const here = { ...ctx, run: { ...locked, ...now } };
    const done = await work(deps, tx, here, chunk);
    if (!done.ok) return done;
    const next = afterChunk(now, chunk, deps.clock.instant(), done.value);
    if (!next.ok) return next;
    await deps.runs.save(tx, tenantId, next.value);
    return ok({ applied: next.value });
  });
  return outcome.ok ? ok(outcome.value.applied) : outcome;
}

const sameChunk = (a: Chunk, b: Chunk): boolean => JSON.stringify(a) === JSON.stringify(b);

async function work(
  deps: RunDeps,
  tx: Tx,
  ctx: RunContext,
  chunk: Chunk,
): Promise<Result<{ total?: number; tally?: Partial<RunCounts>; fields?: number }>> {
  switch (chunk.kind) {
    case 'setup':
      return deps.work.setup(tx, ctx);
    case 'read':
      return deps.work.read(tx, ctx);
    case 'rows': {
      const tally = await deps.work.rows(tx, ctx, chunk.phase, chunk.from, chunk.to);
      return tally.ok ? ok({ tally: tally.value }) : tally;
    }
    case 'finish': {
      const finished = await deps.work.finish(tx, ctx);
      return finished.ok ? ok({}) : finished;
    }
  }
}

/**
 * Stop the run with its reason: what its finished chunks wrote stays, and
 * `people.import.failed` says so. What the worker calls when a chunk keeps
 * failing, too.
 */
export async function stopRun(
  deps: RunDeps,
  tenantId: string,
  runId: string,
  why: string,
): Promise<void> {
  const ctx = await contextOf(deps, tenantId, runId);
  const stopped = await deps.atomically(tenantId, async (tx) => {
    const locked = await deps.runs.find(tx, tenantId, runId, true);
    if (locked === null || !isActive(locked.status)) return ok(null);
    const now = deps.clock.instant();
    const failed = failRun(locked, runFailure(why, peopleDone(locked)), now);
    if (!failed.ok) return failed;
    await deps.runs.save(tx, tenantId, failed.value);
    await deps.publish(tx, [
      {
        eventId: deps.newId(),
        eventName: ImportFailed.name,
        eventVersion: 1,
        tenantId: tenantId as PendingEvent['tenantId'],
        occurredAt: now,
        effectiveFrom: null,
        aggregate: { type: 'Import', id: runId, version: 2 },
        actor: { kind: 'user', userId: locked.actorId },
        correlationId: typeof ctx === 'object' && ctx !== null ? ctx.asking.correlationId : runId,
        causationId: null,
        payload: ImportFailed.payload.parse({
          importId: runId,
          counts: locked.counts,
          reason: failed.value.failure,
          failedAt: now,
        }),
      },
    ]);
    return ok(failed.value);
  });
  if (stopped.ok && stopped.value !== null && typeof ctx === 'object' && ctx !== null) {
    await deps.work.over(ctx, stopped.value);
  }
}

/* --------------------------------------------------------------- view -- */

/** A run as its page, the history and the notices say it. */
export interface ImportRunStatusView {
  readonly id: string;
  readonly status: ImportRun['status'];
  /** The one word for it, everywhere: Importing, Imported or Import failed. */
  readonly label: RunLabel;
  readonly phase: RunPhase;
  /** Where it stands, in words: "Adding people". */
  readonly step: string;
  /** People in, of the rows in the file; the total is null until the file is read. */
  readonly people: { readonly done: number; readonly total: number | null };
  readonly fileName: string | null;
  readonly startedBy: { readonly name: string; readonly you: boolean };
  readonly approvedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** The server's clock, for "4 min so far". */
  readonly now: string;
  /** What it did, as the done step says it: once it succeeded, for a week. */
  readonly result: ImportRunView | null;
  /** Why it stopped, what stays and what to do; null unless it failed. */
  readonly failure: string | null;
}

export interface ViewDeps {
  readonly service: ImportDeps['service'];
  readonly relations: ImportDeps['relations'];
  readonly personOf?: ImportDeps['personOf'];
  readonly runs: RunStore;
  readonly clock: Clock;
  readonly sealed: ObjectStore;
}

/** One run, to HR, People administrators and whoever approved it. */
export async function importRunView(
  deps: ViewDeps,
  asking: Asking,
  runId: string,
): Promise<Result<ImportRunStatusView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await deps.runs.find(tx, asking.tenantId, runId);
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    const mine = found?.actorId === asking.viewer.accountId;
    if (found === null || (!mine && !everyone.isHr && !everyone.isAdmin)) {
      return err(failure('NOT_FOUND', 'There is no such import'));
    }
    return ok(await statusView(deps, tx, asking, found));
  });
}

/** The company's run going now, or null; to HR and People administrators. */
export async function activeImportRunView(
  deps: ViewDeps,
  asking: Asking,
): Promise<Result<ImportRunStatusView | null>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr && !everyone.isAdmin) return ok(null);
    const going = await deps.runs.active(tx, asking.tenantId);
    return ok(going === null ? null : await statusView(deps, tx, asking, going));
  });
}

async function statusView(
  deps: ViewDeps,
  tx: Tx,
  asking: Asking,
  found: StoredRun,
): Promise<ImportRunStatusView> {
  const result =
    found.status === 'succeeded' && found.checksum !== null
      ? await getSealed<ImportRunView>(
          deps.sealed,
          deps.clock,
          resultKey(asking.tenantId, found.checksum),
        )
      : null;
  return {
    id: found.id,
    status: found.status,
    label: labelOf(found.status),
    phase: found.phase,
    step: stepLabel(found.phase),
    people: peopleDone(found),
    fileName: found.name,
    startedBy: await startedBy(deps, tx, asking, found.actorId),
    approvedAt: found.createdAt,
    startedAt: found.startedAt,
    finishedAt: found.finishedAt,
    now: deps.clock.instant(),
    result,
    failure: found.failure,
  };
}

const NOTICE_FOR_MS = 14 * 24 * 60 * 60 * 1000;

export async function importNotices(
  runs: RunStore,
  tx: Tx,
  tenantId: string,
  accountId: string,
  now: string,
): Promise<readonly ImportNotice[]> {
  const since = new Date(Date.parse(now) - NOTICE_FOR_MS).toISOString();
  return (await runs.finished(tx, tenantId, accountId, since)).flatMap((r) =>
    r.finishedAt === null || isActive(r.status)
      ? []
      : [
          {
            id: r.id,
            status: r.status === 'succeeded' ? ('succeeded' as const) : ('failed' as const),
            finishedAt: r.finishedAt,
            people: r.counts.created + r.counts.updated,
            fields: r.fields ?? 0,
            fileName: r.name,
          },
        ],
  );
}

/* --------------------------------------------------------------- work -- */

/** The rows as classified once setup is done, with what the commit writes from. */
interface Classified {
  readonly input: Omit<CommitInput, 'tenantId' | 'viewer' | 'correlationId'>;
  readonly plan: Pick<
    DryRun,
    | 'rows'
    | 'leftEmpty'
    | 'ignoredColumns'
    | 'effectiveFrom'
    | 'findings'
    | 'blockedItems'
    | 'sheets'
    | 'rowsRead'
  >;
}

/** One row's outcome, as a batch keeps it: no values but the reason. */
type Written = Pick<Outcome, 'written' | 'reason' | 'personId'> & { readonly row: number };

export type WorkDeps = NewFieldsDeps &
  ImportDeps & {
    readonly sealed: ObjectStore;
    /** The settings log, for the fields a run adds. Absent, not logged. */
    readonly activity?: ActivityStore;
  };

/**
 * The chunks' work over People's own use cases: `setUpImport` for setup,
 * the commit's dry run, row writes, links, lifecycle moves and record.
 */
export function importWork(deps: WorkDeps): RunWork {
  const key = (ctx: RunContext, name: string) => runKey(ctx.asking.tenantId, ctx.run.id, name);
  // ponytail: one run's working copies held in memory, the last run read; a
  // chunk re-reads them only after a restart. Two runs at once (two
  // companies) take turns at the cache, each still correct.
  let cache: { readonly runId: string; readonly items: Map<string, unknown> } | null = null;
  const get = async <T>(ctx: RunContext, name: string): Promise<T | null> => {
    if (cache?.runId !== ctx.run.id) cache = { runId: ctx.run.id, items: new Map() };
    const items = cache.items;
    if (items.has(name)) return items.get(name) as T;
    const value = await getSealed<T>(deps.sealed, deps.clock, key(ctx, name));
    if (value !== null) items.set(name, value);
    return value;
  };
  const put = async (ctx: RunContext, name: string, value: unknown) => {
    await putSealed(deps.sealed, key(ctx, name), value);
    if (cache?.runId === ctx.run.id) cache.items.set(name, value);
  };
  const gone = (what: string) => err(failure('RUN_LOST', `The import's ${what} is no longer held`));

  const classified = async (ctx: RunContext) => {
    const c = await get<Classified>(ctx, 'rows');
    return c === null ? null : { ...c, input: { ...c.input, ...ctx.asking } as CommitInput };
  };
  /** Every row's outcome so far, in the file's order. */
  const outcomes = async (
    ctx: RunContext,
    c: NonNullable<Awaited<ReturnType<typeof classified>>>,
  ) => {
    const total = c.plan.rows.length;
    const written = new Map<number, Written>();
    for (let from = 0; from < total; from += BATCH) {
      // eslint-disable-next-line no-await-in-loop -- one batch file at a time, cached
      for (const w of (await get<Written[]>(ctx, `people-${String(from)}`)) ?? [])
        written.set(w.row, w);
    }
    return c.plan.rows.map((row): Outcome => {
      const w = written.get(row.row);
      return w === undefined
        ? { row, written: 'blocked', reason: 'not written', personId: null }
        : { row, written: w.written, reason: w.reason, personId: w.personId };
    });
  };
  const leftIn = async (ctx: RunContext, phase: 'managers' | 'lifecycle', total: number) => {
    const left: LeftEmpty[] = [];
    for (let from = 0; from < total; from += BATCH) {
      // eslint-disable-next-line no-await-in-loop -- one batch file at a time
      left.push(...((await get<LeftEmpty[]>(ctx, `${phase}-${String(from)}`)) ?? []));
    }
    return left;
  };

  return {
    async setup(tx, ctx) {
      const set = await setUpImport(deps, ctx.asking, {
        ...ctx.input,
        applySensitiveWithoutApproval: true,
      });
      if (!set.ok) return set;
      await put(ctx, 'setup', set.value);
      const added = set.value.fields;
      if (deps.activity !== undefined && added.length > 0 && set.value.published) {
        await deps.activity.record(tx, ctx.asking.tenantId, {
          id: deps.commit.newId(),
          at: deps.clock.instant(),
          actor: ctx.asking.viewer.accountId,
          action: `Added ${String(added.length)} ${added.length === 1 ? 'field' : 'fields'} from an import, with the AI assistant`,
          subject: null,
          detail: `${added.map((f) => f.label).join(', ')}. Approved with the import’s plan.`.slice(
            0,
            500,
          ),
          area: 'fields',
          onBehalfOf: ctx.asking.viewer.support?.operatorId ?? null,
          reason: ctx.asking.viewer.support?.reason ?? null,
          idempotencyKey: `import-run:${ctx.run.id}`,
        });
      }
      return ok({ fields: set.value.published ? added.length : 0 });
    },

    async read(tx, ctx) {
      const set = await get<SetUp>(ctx, 'setup');
      if (set === null) return gone('setup');
      const read = await commitInputOf(deps, ctx.asking, {
        uploadId: ctx.input.uploadId,
        mapping: Object.fromEntries(
          Object.entries(set.mapping).map(([index, k]) => [Number(index), k]),
        ),
        ...(set.places === undefined ? {} : { places: placeChoices(set.places) }),
        // Approving the plan is the approval: the values it imports, sensitive
        // ones included, are written, not held for a second HR member.
        applySensitiveWithoutApproval: true,
      });
      if (!read.ok) return read;
      const { input } = read.value;
      const planned = await dryRun(tx, importDeps(deps), input);
      if (!planned.ok) return planned;
      const plan = planned.value;
      const { tenantId: _t, viewer: _v, correlationId: _c, ...rest } = input;
      await put(ctx, 'rows', {
        input: rest,
        plan: {
          rows: plan.rows,
          leftEmpty: plan.leftEmpty,
          ignoredColumns: plan.ignoredColumns,
          effectiveFrom: plan.effectiveFrom,
          findings: plan.findings,
          blockedItems: plan.blockedItems,
          sheets: plan.sheets,
          rowsRead: plan.rowsRead,
        },
      } satisfies Classified);
      await deps.commit.ledger.publish(tx, [
        importStarted(importDeps(deps), input, ctx.run.id, plan),
      ]);
      return ok({ total: plan.rows.length });
    },

    async rows(tx, ctx, phase, from, to) {
      const c = await classified(ctx);
      if (c === null) return gone('file');
      const cdeps = importDeps(deps);
      await planForKeyLookups(tx);
      if (phase === 'people') {
        const done: Outcome[] = [];
        for (const row of c.plan.rows.slice(from, to)) {
          // eslint-disable-next-line no-await-in-loop -- one savepoint per row, in order
          done.push(await writeRow(tx, cdeps, c.input, row));
        }
        await put(
          ctx,
          `people-${String(from)}`,
          done.map((o): Written => ({
            row: o.row.row,
            written: o.written,
            reason: o.reason,
            personId: o.personId,
          })),
        );
        return ok(countsOf(done));
      }
      const all = await outcomes(ctx, c);
      const these = all.slice(from, to);
      const left =
        phase === 'managers'
          ? await linkRows(tx, cdeps, c.input, all, these)
          : await settleRows(tx, cdeps, c.input, these);
      await put(ctx, `${phase}-${String(from)}`, left);
      return ok({});
    },

    async finish(tx, ctx) {
      const [c, set] = [await classified(ctx), await get<SetUp>(ctx, 'setup')];
      if (c === null || set === null) return gone('file');
      const all = await outcomes(ctx, c);
      const total = c.plan.rows.length;
      const leftEmpty = [
        ...c.plan.leftEmpty,
        ...(await leftIn(ctx, 'managers', total)),
        ...(await leftIn(ctx, 'lifecycle', total)),
      ];
      const cdeps = importDeps(deps);
      const claim = await cdeps.ledger.claim(tx, {
        tenantId: ctx.asking.tenantId,
        importId: ctx.run.id,
        checksum: c.input.file.checksum,
        actorId: ctx.run.actorId,
        rowCount: c.plan.rowsRead,
        name: ctx.run.name,
      });
      if (!claim.claimed && claim.importId !== ctx.run.id) {
        return err(
          failure('ALREADY_IMPORTED', 'This exact file was imported while this import ran'),
        );
      }
      // Everybody without a detail asked of them, once, for all of them.
      const requested = await requestFromImport(
        deps,
        tx,
        ctx.asking,
        set.fields.filter((f) => f.forExisting.kind === 'ask'),
        all.flatMap((o) =>
          o.personId === null || o.written === 'blocked' || o.written === 'duplicate'
            ? []
            : [{ personId: o.personId, cells: o.row.cells, left: o.row.lifecycle?.kind === 'left' }],
        ),
      );
      if (!requested.ok) return requested;
      const committed = await recordImport(tx, cdeps, c.input, ctx.run.id, c.plan, all, leftEmpty);
      const done = await doneViewOf(deps, ctx.asking, ctx.run.name ?? '', c.input, committed);
      const finishedAt = deps.clock.instant();
      await putSealed(
        deps.sealed,
        resultKey(ctx.asking.tenantId, c.input.file.checksum),
        runViewOf(set, done, ctx.run.createdAt, finishedAt),
      );
      return ok(null);
    },

    async over(ctx, ended) {
      const c = await get<Classified>(ctx, 'rows');
      const total = c?.plan.rows.length ?? 0;
      const names = ['input', 'setup', 'rows'];
      for (let from = 0; from < total; from += BATCH) {
        names.push(...['people', 'managers', 'lifecycle'].map((p) => `${p}-${String(from)}`));
      }
      for (const name of names) {
        // eslint-disable-next-line no-await-in-loop -- a few dozen deletes, once
        await deps.sealed.remove(key(ctx, name));
      }
      cache = null;
      // The upload has done its work once the rows are read; a failed run
      // before that leaves it for HR to try again with.
      if (ended.status === 'succeeded' || c !== null) {
        const intent = await run(deps.service, ctx.asking.tenantId, async (t) =>
          ok(await deps.uploads.intents.find(t, ctx.asking.tenantId, ctx.input.uploadId)),
        );
        if (intent.ok && intent.value !== null) await releaseUpload(deps, ctx.asking, intent.value);
      }
    },
  };
}

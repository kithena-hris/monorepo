import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import { ImportCompleted, ImportStarted, type Actor } from '@kithena/contracts';

import { currentValue } from '../../domain/person/history.js';
import { REPORT_LIFETIME_MS, type ObjectStore } from '../export/object-store.js';
import { inTenantResult, type Asking, type PersonAccess } from '../person/person-access.js';
import { holds } from '../person/pending-changes.js';
import type { InTenant } from '../person/service.js';
import { writeCsv } from './csv.js';
import { PERSON_ID_COLUMN } from './parse.js';
import {
  dryRun,
  type BlockedItem,
  type ClassifiedRow,
  type DryRun,
  type DryRunDeps,
  type DryRunInput,
} from './dry-run.js';

/**
 * Commit an import (PRD §14.5), and report on it.
 *
 * **Partial.** Blocked rows never prevent good ones: each row is written in
 * its own savepoint, so a row the write path refuses — a work email somebody
 * else claimed a second ago — rolls back alone and joins the report.
 *
 * **Idempotent by constraint.** The import key is the file's SHA-256, claimed
 * with an insert against `UNIQUE (tenant_id, checksum)` before anything else.
 * Two uploads of one file race on that index, not on a read: the second waits
 * for the first to commit and is then told "already imported", which is the
 * mistake every importer makes once, made impossible rather than unlikely.
 *
 * **Through the write path.** Every value goes through `PersonAccess` — the
 * same ownership check, validation, uniqueness claims, history and events as
 * a form. The dry run is recomputed here, never taken from the client.
 *
 * **Audited without the data.** `people.import.started` and `.completed`
 * carry counts, attribute keys and the file's checksum: never a value, never
 * the file. The report does carry values — the blocked rows, as uploaded — so
 * it is never put on an event; it is kept only sealed in the object store
 * (AES-256-GCM before it leaves the process), keyed by the import's checksum,
 * for `REPORT_LIFETIME_MS`, and reached through a signed link that expires, so
 * a re-upload of the same file can hand it back (PEO-090). Beside it, the ids
 * of the people it contains, so erasing one deletes it (`forgetImportReports`).
 */

export interface ImportLedger {
  /**
   * Claim the import key, inside the caller's transaction. `claimed: false`
   * means a committed import already holds it.
   */
  claim(
    tx: PostgresJsDatabase,
    entry: {
      tenantId: string;
      importId: string;
      checksum: string;
      actorId: string;
      rowCount: number;
    },
  ): Promise<{ claimed: true } | { claimed: false; importId: string }>;
  complete(
    tx: PostgresJsDatabase,
    tenantId: string,
    importId: string,
    counts: ImportCounts,
  ): Promise<void>;
  /** Into the outbox, in the same transaction. */
  publish(tx: PostgresJsDatabase, events: readonly PendingEvent[]): Promise<void>;
}

/** One row's writes, rolled back alone when they are refused. */
export type RowScope = <T>(
  tx: PostgresJsDatabase,
  fn: (tx: PostgresJsDatabase) => Promise<Result<T>>,
) => Promise<Result<T>>;

export interface CommitDeps extends DryRunDeps {
  readonly access: PersonAccess;
  readonly ledger: ImportLedger;
  readonly rowScope: RowScope;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly reports: StoredReports;
}

/** Where blocked-row reports are kept, and which people each contains. */
export interface StoredReports {
  /** The export's store: its key seals the report, its route opens the link. */
  readonly store: ObjectStore;
  readonly index: ReportIndex;
}

/**
 * The people each stored report contains, by id — never a value — so an
 * erasure finds exactly the reports to delete. Takes the caller's transaction.
 */
export interface ReportIndex {
  save(
    tx: PostgresJsDatabase,
    entry: {
      readonly tenantId: string;
      readonly checksum: string;
      readonly personIds: readonly string[];
      readonly storedAt: string;
      readonly expiresAt: string;
    },
  ): Promise<void>;
  /** When the report for this file expires, or null when none is held. */
  expiresAt(tx: PostgresJsDatabase, tenantId: string, checksum: string): Promise<string | null>;
  /** The checksums of every report that contains this person. */
  containing(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<readonly string[]>;
  remove(tx: PostgresJsDatabase, tenantId: string, checksums: readonly string[]): Promise<void>;
}

/** How long a link to a stored report works: an export link's day, or less. */
export const REPORT_LINK_MS = 24 * 60 * 60 * 1000;

/**
 * Where an import's report lives. Keyed by the checksum, which is the import
 * key: a retried commit overwrites rather than orphans, and a re-upload finds
 * it. The `imports/` prefix is what gives it a report's 7 days in the export
 * sweep and the bucket's lifecycle rule, rather than an export file's one
 * (`lifetimeOf` in `object-store.ts`).
 */
export const reportKey = (tenantId: string, checksum: string): string =>
  `imports/${tenantId}/${checksum}/blocked-rows.csv`;

/** A link to the stored report, or null once it has expired or been erased. */
async function reportLink(
  tx: PostgresJsDatabase,
  deps: CommitDeps,
  tenantId: string,
  checksum: string,
): Promise<string | null> {
  const expires = await deps.reports.index.expiresAt(tx, tenantId, checksum);
  if (expires === null || Date.parse(expires) <= Date.parse(deps.clock.instant())) return null;
  return signReport(deps, tenantId, checksum, expires);
}

/** A day's link, never outliving the report it opens. */
function signReport(
  deps: CommitDeps,
  tenantId: string,
  checksum: string,
  reportExpires: string,
): Promise<string> {
  const until = Math.min(Date.parse(deps.clock.instant()) + REPORT_LINK_MS, Date.parse(reportExpires));
  return deps.reports.store.sign(reportKey(tenantId, checksum), new Date(until).toISOString());
}

/**
 * Delete every stored report that contains this person, object and index
 * row: what an erasure calls, so a report never outlives the people in it.
 */
export async function forgetImportReports(
  tx: PostgresJsDatabase,
  reports: StoredReports,
  tenantId: string,
  personId: string,
): Promise<number> {
  const checksums = await reports.index.containing(tx, tenantId, personId);
  for (const checksum of checksums) {
    // eslint-disable-next-line no-await-in-loop -- a handful of reports, one delete each
    await reports.store.remove(reportKey(tenantId, checksum));
  }
  await reports.index.remove(tx, tenantId, checksums);
  return checksums.length;
}

export interface ImportCounts {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly blocked: number;
  readonly duplicate: number;
  readonly incomplete: number;
}

export type CommitResult =
  | {
      readonly status: 'already_imported';
      readonly importId: string;
      /** The report that import stored, signed again; null once it expired or was erased. */
      readonly reportUrl: string | null;
    }
  | {
      readonly status: 'imported';
      readonly importId: string;
      readonly counts: ImportCounts;
      /** Which rows were not imported, why, and with what they held — downloadable CSV. */
      readonly report: Uint8Array;
      /** The same report, stored sealed, behind a link that expires. */
      readonly reportUrl: string;
      readonly ignoredColumns: readonly string[];
      /** §14.5: which date dated facts took. */
      readonly effectiveFrom: DryRun['effectiveFrom'];
      /** Doubted national identifiers that imported and went to HR's review (PEO-125). */
      readonly findings: DryRun['findings'];
      /**
       * Values the rows written carried for fields that require approval
       * (PEO-077): held for HR, unless HR applied them without approval.
       */
      readonly held: number;
    };

interface Outcome {
  readonly row: ClassifiedRow;
  readonly written: 'created' | 'updated' | 'unchanged' | 'blocked' | 'duplicate';
  readonly reason: string | null;
}

export async function commitImport(
  tx: PostgresJsDatabase,
  deps: CommitDeps,
  input: DryRunInput,
): Promise<Result<CommitResult>> {
  const planned = await dryRun(tx, deps, input);
  if (!planned.ok) return planned;
  const plan = planned.value;

  const importId = deps.newId();
  const claim = await deps.ledger.claim(tx, {
    tenantId: input.tenantId,
    importId,
    checksum: input.file.checksum,
    actorId: input.viewer.accountId,
    rowCount: plan.rowsRead,
  });
  if (!claim.claimed) {
    return ok({
      status: 'already_imported',
      importId: claim.importId,
      reportUrl: await reportLink(tx, deps, input.tenantId, input.file.checksum),
    });
  }

  const actor: Actor = { kind: 'user', userId: input.viewer.accountId };
  const attributeKeys = [
    ...new Set([
      ...input.mapping.flatMap((m) =>
        m.status === 'mapped' &&
        m.key !== null &&
        !m.key.startsWith('_') &&
        m.key !== 'effective_from'
          ? [m.key]
          : [],
      ),
      ...plan.sheets.filter((s) => s.imported).map((s) => s.key),
    ]),
  ];
  await deps.ledger.publish(tx, [
    event(
      deps,
      input,
      actor,
      importId,
      'people.import.started',
      ImportStarted.payload.parse({
        importId,
        rowCount: plan.rowsRead,
        attributeKeys,
        checksum: input.file.checksum,
      }),
    ),
  ]);

  const outcomes: Outcome[] = [];
  for (const row of plan.rows) outcomes.push(await write(tx, deps, input, row));

  const tally = (w: Outcome['written']) => outcomes.filter((o) => o.written === w).length;
  const counts: ImportCounts = {
    created: tally('created'),
    updated: tally('updated'),
    unchanged: tally('unchanged'),
    blocked: tally('blocked'),
    duplicate: tally('duplicate'),
    incomplete: outcomes.filter(
      (o) => (o.written === 'created' || o.written === 'updated') && o.row.missing.length > 0,
    ).length,
  };

  await deps.ledger.complete(tx, input.tenantId, importId, counts);
  await deps.ledger.publish(tx, [
    event(
      deps,
      input,
      actor,
      importId,
      'people.import.completed',
      ImportCompleted.payload.parse({ importId, counts, completedAt: deps.clock.instant() }),
    ),
  ]);

  const blocked = report(input, outcomes, plan.blockedItems);
  const storedAt = deps.clock.instant();
  const expiresAt = new Date(Date.parse(storedAt) + REPORT_LIFETIME_MS).toISOString();
  await deps.reports.store.put(
    reportKey(input.tenantId, input.file.checksum),
    blocked,
    'text/csv',
  );
  await deps.reports.index.save(tx, {
    tenantId: input.tenantId,
    checksum: input.file.checksum,
    personIds: [
      ...new Set(
        [
          ...outcomes
            .filter((o) => o.written === 'blocked' || o.written === 'duplicate')
            .map((o) => o.row.personId),
          ...plan.blockedItems.map((i) => i.personId),
        ].filter((id): id is string => id !== null),
      ),
    ],
    storedAt,
    expiresAt,
  });

  const version = await deps.schemas.current(tx, input.tenantId);
  const sensitive = new Set(
    (version?.document.attributes ?? []).filter((d) => holds(d)).map((d) => d.key as string),
  );
  const held =
    input.applySensitiveWithoutApproval === true
      ? 0
      : outcomes
          .filter((o) => o.written === 'created' || o.written === 'updated')
          .reduce(
            (n, o) => n + Object.keys(o.row.changes).filter((k) => sensitive.has(k)).length,
            0,
          );

  return ok({
    status: 'imported',
    importId,
    counts,
    held,
    report: blocked,
    reportUrl: await signReport(deps, input.tenantId, input.file.checksum, expiresAt),
    ignoredColumns: plan.ignoredColumns,
    effectiveFrom: plan.effectiveFrom,
    findings: plan.findings.filter((f) =>
      outcomes.some(
        (o) => o.row.row === f.row && (o.written === 'created' || o.written === 'updated'),
      ),
    ),
  });
}

/**
 * `commitImport` in a transaction of its own, retried when Postgres chose it
 * as the loser of a deadlock or a serialization conflict (PEO-106).
 *
 * An import is one long transaction, and each row takes the unique-claim
 * locks for the rules it writes — sorted within the row, but a later row can
 * take a rule an earlier row of another import already holds. Two imports
 * working through rules in different orders can therefore deadlock (40P01),
 * and Postgres breaks the cycle by aborting one of them whole. Nothing of the
 * loser was committed, so running it again is safe; the winner has committed
 * by then, or is about to, so the second attempt queues behind it rather than
 * deadlocking again.
 *
 * Idempotent by the file's checksum, as the commit itself is: a retry that
 * finds the checksum already claimed answers "already imported". Bounded:
 * `attempts` tries (3 by default) with exponential backoff and jitter, then a
 * clear refusal — nothing was imported, upload again — rather than a 500.
 */
export async function commitImportRetrying(
  inTenant: InTenant,
  deps: CommitDeps,
  input: DryRunInput,
  options: {
    readonly attempts?: number;
    readonly backoffMs?: number;
    /** Told each time an attempt lost, with its SQLSTATE, before waiting. */
    readonly onRetry?: (attempt: number, code: string) => void;
  } = {},
): Promise<Result<CommitResult>> {
  const attempts = options.attempts ?? 3;
  const backoff = options.backoffMs ?? 100;
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- a retry waits for the attempt before it
      return await inTenantResult(inTenant, input.tenantId, (tx) => commitImport(tx, deps, input));
    } catch (error) {
      const code = contention(error);
      if (code === null) throw error;
      if (attempt >= attempts) {
        return err(
          failure(
            'IMPORT_CONTENDED',
            `Another write to the same fields won ${String(attempts)} times in a row; nothing from this file was imported. Upload it again.`,
          ),
        );
      }
      options.onRetry?.(attempt, code);
      const wait = backoff * 2 ** (attempt - 1) * (1 + Math.random());
      // eslint-disable-next-line no-await-in-loop -- the backoff is the point
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** The SQLSTATE of a deadlock or serialization failure anywhere in the cause chain, else null. */
function contention(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e !== null && e !== undefined && depth < 5; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (code === '40P01' || code === '40001') return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

async function write(
  tx: PostgresJsDatabase,
  deps: CommitDeps,
  input: DryRunInput,
  row: ClassifiedRow,
): Promise<Outcome> {
  if (row.outcome === 'blocked') {
    return {
      row,
      written: 'blocked',
      reason: row.problems.map((p) => `${p.column}: ${p.reason}`).join('; '),
    };
  }
  if (row.outcome === 'duplicate') {
    const why =
      row.matchedOn === 'earlier_row'
        ? 'the same person appears earlier in this file'
        : 'looks like a person already held; review before importing';
    return { row, written: 'duplicate', reason: why };
  }
  if (row.outcome === 'unchanged') return { row, written: 'unchanged', reason: null };

  const asking: Asking = {
    tenantId: input.tenantId,
    viewer: input.viewer,
    correlationId: input.correlationId,
    ...(input.applySensitiveWithoutApproval === true
      ? { applySensitiveWithoutApproval: true }
      : {}),
  };

  const done = await deps.rowScope(tx, async (sp) => {
    if (row.outcome === 'update' && row.personId !== null) {
      const dated = row.effectiveFrom ? { effectiveFrom: row.effectiveFrom } : {};
      if (row.hireDateCorrection) {
        return correctHireDate(sp, deps, asking, row.personId, row.hireDateCorrection.to, {
          ...dated,
          changes: row.changes,
        });
      }
      // A provisional record — an account nobody has confirmed yet (§8.2) —
      // is hired by a row that gives it a start date, its values written with
      // the hire so identity hears the result once.
      const written =
        row.hires && row.hireDate !== null
          ? await deps.access.hire(sp, {
              ...asking,
              ...dated,
              personId: row.personId,
              hireDate: row.hireDate,
              changes: row.changes,
            })
          : await deps.access.update(sp, {
              ...asking,
              ...dated,
              personId: row.personId,
              changes: row.changes,
            });
      return written.ok ? ok('updated' as const) : written;
    }
    return create(sp, deps, asking, row);
  });

  return done.ok
    ? { row, written: done.value, reason: null }
    : { row, written: 'blocked', reason: done.error.message };
}

/**
 * The row's other changes, then the start date as a correction of the one
 * recorded (§8.5): `supersedes` the hire date in force, through
 * `PersonAccess.correct`, which moves the column, re-reads the state (a date
 * moved into the future returns the person to pre-hire, PEO-100) and raises
 * `attribute_corrected` — never a silent overwrite of the column.
 */
async function correctHireDate(
  tx: PostgresJsDatabase,
  deps: CommitDeps,
  asking: Asking,
  personId: string,
  hireDate: string,
  also: { readonly changes: Readonly<Record<string, unknown>>; readonly effectiveFrom?: string },
): Promise<Result<'updated'>> {
  if (Object.keys(also.changes).length > 0) {
    const updated = await deps.access.update(tx, { ...asking, ...also, personId });
    if (!updated.ok) return updated;
  }
  const history = await deps.access.history(tx, { ...asking, personId, attributeKey: 'hire_date' });
  if (!history.ok) return history;
  const held = currentValue(history.value, 'hire_date');
  if (!held) {
    return err(
      failure('HIRE_DATE_UNRECORDED', 'Hire date: no recorded hire date to correct', ['hire_date']),
    );
  }
  const corrected = await deps.access.correct(tx, {
    ...asking,
    personId,
    supersedes: held.id,
    value: hireDate,
    reason: 'Corrected by import',
  });
  return corrected.ok ? ok('updated') : corrected;
}

/**
 * A new person: created with what takes effect now, then dated facts from the
 * row's `effective_from` or else their hire date (§14.5), then hired.
 */
async function create(
  tx: PostgresJsDatabase,
  deps: CommitDeps,
  asking: Asking,
  row: ClassifiedRow,
): Promise<Result<'created'>> {
  const version = await deps.schemas.current(tx, asking.tenantId);
  const dated = new Set<string>(
    version?.document.attributes.filter((d) => d.effectiveDated).map((d) => d.key),
  );
  const now = Object.fromEntries(Object.entries(row.changes).filter(([k]) => !dated.has(k)));
  const later = Object.fromEntries(Object.entries(row.changes).filter(([k]) => dated.has(k)));

  const created = await deps.access.create(tx, {
    ...asking,
    attributes: Object.keys(now).length > 0 ? now : later,
  });
  if (!created.ok) return created;
  const personId = created.value.id;

  const effectiveFrom = row.effectiveFrom ?? row.hireDate;
  if (Object.keys(now).length > 0 && Object.keys(later).length > 0) {
    const updated = await deps.access.update(tx, {
      ...asking,
      personId,
      changes: later,
      ...(effectiveFrom ? { effectiveFrom } : {}),
    });
    if (!updated.ok) return updated;
  }

  if (row.hireDate !== null) {
    const hired = await deps.access.hire(tx, { ...asking, personId, hireDate: row.hireDate });
    if (!hired.ok) return hired;
  }
  return ok('created');
}

function event(
  deps: CommitDeps,
  input: DryRunInput,
  actor: Actor,
  importId: string,
  eventName: string,
  payload: unknown,
): PendingEvent {
  return {
    eventId: deps.newId(),
    eventName,
    eventVersion: 1,
    tenantId: input.tenantId as PendingEvent['tenantId'],
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'Import', id: importId, version: eventName.endsWith('started') ? 1 : 2 },
    actor,
    correlationId: input.correlationId,
    causationId: null,
    payload,
  };
}

/**
 * The rows that did not import, as a file that imports once fixed.
 *
 * The original header (and key row, for a round-tripped export), the
 * original cells, and two columns the mapper recognises and ignores:
 * `__source_row` and `__reason`. Fix the cells, upload it, and it maps the
 * way the original did.
 */
function report(
  input: DryRunInput,
  outcomes: readonly Outcome[],
  items: readonly BlockedItem[],
): Uint8Array {
  const failed = outcomes.filter((o) => o.written === 'blocked' || o.written === 'duplicate');
  return blockedReport(
    input.file,
    failed.map((o) => ({ row: o.row, reason: o.reason ?? o.written })),
    items,
  );
}

/**
 * That file, from any list of rows and reasons: the commit's report, and the
 * dry run's blocked rows before anything is committed (PEO-055).
 */
export function blockedReport(
  file: Pick<DryRunInput['file'], 'headers' | 'keys'>,
  failed: readonly {
    readonly row: Pick<ClassifiedRow, 'cells' | 'row'>;
    readonly reason: string;
  }[],
  items: readonly BlockedItem[] = [],
): Uint8Array {
  const rows: string[][] = [[...file.headers, '__source_row', '__reason']];
  if (file.keys) rows.push([...file.keys, '__source_row', '__reason']);
  for (const f of failed) rows.push([...f.row.cells, String(f.row.row), f.reason]);
  // A repeating sheet's item, on a row of its own: the person's id where the
  // file has that column and nothing else, so uploading the report again
  // leaves them unchanged. `__source_row` names the sheet and row, `__reason`
  // the cell. The fix is made on that sheet of the original file.
  const idAt = file.keys?.indexOf(PERSON_ID_COLUMN) ?? -1;
  for (const item of items) {
    const cells = file.headers.map((_, i) => (i === idAt ? (item.personId ?? '') : ''));
    const value = item.value === '' ? 'empty' : `“${item.value}”`;
    rows.push([
      ...cells,
      `${item.sheet}!${String(item.row)}`,
      `${item.cell} ${value}: ${item.reason}`,
    ]);
  }
  return writeCsv(rows);
}

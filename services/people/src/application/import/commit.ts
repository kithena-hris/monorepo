import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import { ImportCompleted, ImportStarted, type Actor } from '@kithena/contracts';

import type { Asking, PersonAccess } from '../person/person-access.js';
import { writeCsv } from './csv.js';
import {
  dryRun,
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
 * carry counts and attribute keys: never a value, never the file. The report
 * does carry values — the blocked rows, as uploaded — and is returned to the
 * importer, not stored and not put on an event.
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
  | { readonly status: 'already_imported'; readonly importId: string }
  | {
      readonly status: 'imported';
      readonly importId: string;
      readonly counts: ImportCounts;
      /** Which rows were not imported, why, and with what they held — downloadable CSV. */
      readonly report: Uint8Array;
      readonly ignoredColumns: readonly string[];
      /** §14.5: which date dated facts took. */
      readonly effectiveFrom: DryRun['effectiveFrom'];
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
  if (!claim.claimed) return ok({ status: 'already_imported', importId: claim.importId });

  const actor: Actor = { kind: 'user', userId: input.viewer.accountId };
  const attributeKeys = [
    ...new Set(
      input.mapping.flatMap((m) =>
        m.status === 'mapped' &&
        m.key !== null &&
        !m.key.startsWith('_') &&
        m.key !== 'effective_from'
          ? [m.key]
          : [],
      ),
    ),
  ];
  await deps.ledger.publish(tx, [
    event(
      deps,
      input,
      actor,
      importId,
      'people.import.started',
      ImportStarted.payload.parse({ importId, rowCount: plan.rowsRead, attributeKeys }),
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

  return ok({
    status: 'imported',
    importId,
    counts,
    report: report(input, outcomes),
    ignoredColumns: plan.ignoredColumns,
    effectiveFrom: plan.effectiveFrom,
  });
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
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  };

  const done = await deps.rowScope(tx, async (sp) => {
    if (row.outcome === 'update' && row.personId !== null) {
      if (Object.keys(row.changes).length > 0) {
        const updated = await deps.access.update(sp, {
          ...asking,
          personId: row.personId,
          changes: row.changes,
          ...(row.effectiveFrom ? { effectiveFrom: row.effectiveFrom } : {}),
        });
        if (!updated.ok) return updated;
      }
      // A provisional record — an account nobody has confirmed yet (§8.2) —
      // is hired by a row that gives it a start date.
      if (row.hires && row.hireDate !== null) {
        const hired = await deps.access.hire(sp, {
          ...asking,
          personId: row.personId,
          hireDate: row.hireDate,
        });
        if (!hired.ok) return hired;
      }
      return ok('updated' as const);
    }
    return create(sp, deps, asking, row);
  });

  return done.ok
    ? { row, written: done.value, reason: null }
    : { row, written: 'blocked', reason: done.error.message };
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
function report(input: DryRunInput, outcomes: readonly Outcome[]): Uint8Array {
  const failed = outcomes.filter((o) => o.written === 'blocked' || o.written === 'duplicate');
  const rows: string[][] = [[...input.file.headers, '__source_row', '__reason']];
  if (input.file.keys) rows.push([...input.file.keys, '__source_row', '__reason']);
  for (const o of failed) rows.push([...o.row.cells, String(o.row.row), o.reason ?? o.written]);
  return writeCsv(rows);
}

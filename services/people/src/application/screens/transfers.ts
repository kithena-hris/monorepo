import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { ExportFormat } from '../export/export.js';
import type { ObjectStore } from '../export/object-store.js';
import { REPORT_LINK_MS, reportKey, type ImportCounts } from '../import/commit.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { actors } from './people.js';
import { avatarsOf } from './photo.js';
import { NOBODY, type ScreenDeps } from './record.js';

/**
 * Import & export's one history (design V6): every import and every export,
 * newest first, whoever ran it. HR's and People administrators', the people
 * who import, as the settings activity is theirs.
 *
 * Read from the two ledgers, `people.import` and `people.export`, which hold
 * who, when, the file's name or the export's reason, and what came of it —
 * never a value and never a link. So the downloads here are made, not kept:
 *
 * - an **export** is downloadable by whoever asked for it while its files are
 *   still there, and only then: `GET /v1/exports/{id}` re-signs its links for
 *   the requester and nobody else, and the history agrees with it rather
 *   than offering anybody a button that answers "not yours";
 * - an **import**'s blocked-row report is linked while it is kept (7 days, or
 *   until somebody in it is erased), signed for a day at most, as a
 *   re-upload of the same file hands it back.
 */

export const TRANSFER_PAGE = 50;

/** One ledger row as the store reads it. The import's columns or the export's; the rest null. */
export interface TransferRow {
  readonly kind: 'import' | 'export';
  readonly id: string;
  /** When it was started (an import) or asked for (an export). */
  readonly at: string;
  /** The account that ran it. */
  readonly actor: string;
  /** An import's file name as uploaded; null before the ledger kept one. */
  readonly name: string | null;
  /** An import's outcome; null while it runs. */
  readonly counts: ImportCounts | null;
  /** An export's rows; null while it is being prepared. */
  readonly rowCount: number | null;
  readonly format: ExportFormat | null;
  readonly reason: string | null;
  readonly fileNames: readonly string[] | null;
  /** When an export's links stop working; null while it is being prepared. */
  readonly expiresAt: string | null;
  /** An import's key, and when its stored report expires; null when none is kept. */
  readonly checksum: string | null;
  readonly reportExpiresAt: string | null;
}

export interface TransferHistory {
  /** Newest first; `before` is the id of the last row of the page before. */
  page(
    tx: PostgresJsDatabase,
    tenantId: string,
    page: { readonly before: string | null; readonly limit: number },
  ): Promise<readonly TransferRow[]>;
}

export interface TransferView {
  readonly id: string;
  readonly kind: 'import' | 'export';
  /**
   * An import's file name; an export's reason, else the name of the file it
   * made. Null when the ledger knows neither (an export still being prepared,
   * or a row from before the ledger kept them).
   */
  readonly title: string | null;
  readonly by: { readonly name: string; readonly avatarUrl: string | null };
  readonly at: string;
  /** Blocked counts the duplicates with the refused rows, as the import's own summary does. */
  readonly imported: {
    readonly created: number;
    readonly updated: number;
    readonly blocked: number;
  } | null;
  readonly exported: { readonly rows: number; readonly format: ExportFormat | null } | null;
  /** The viewer's own export, still there: `peopleExport(id)` hands them its files. */
  readonly downloadable: boolean;
  /** An import's blocked-row report, while it is kept: a link that expires. */
  readonly reportUrl: string | null;
}

export interface TransferHistoryView {
  readonly items: readonly TransferView[];
  /** The cursor for older entries; null when there are none. */
  readonly next: string | null;
}

export type TransferDeps = ScreenDeps & {
  /** The two ledgers, read together. Absent, the history is not kept here. */
  readonly transfers?: TransferHistory;
  /** Where import reports are kept: only its signing is used here. */
  readonly reports?: Pick<ObjectStore, 'sign'>;
};

export async function transferHistoryView(
  deps: TransferDeps,
  asking: Asking,
  before: string | null,
  limit = TRANSFER_PAGE,
): Promise<Result<TransferHistoryView>> {
  const store = deps.transfers;
  if (store === undefined) return err(failure('UNAVAILABLE', 'The history is not kept here'));
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr && !everyone.isAdmin) {
      return err(
        failure('FORBIDDEN', 'The import and export history is for HR and People administrators'),
      );
    }
    const rows = await store.page(tx, asking.tenantId, { before, limit: limit + 1 });
    const shown = rows.slice(0, limit);
    const who = shown.map((r) => ({ kind: 'user' as const, userId: r.actor }));
    // Named as anybody would see them: the history names people, "You" included.
    const named = await actors(
      deps,
      tx,
      { ...asking, viewer: { ...asking.viewer, accountId: NOBODY } },
      who,
    );
    const people = new Map<string, string>();
    for (const r of shown) {
      if (people.has(r.actor)) continue;
      const personId = await deps.personOf(tx, asking.tenantId, r.actor);
      if (personId !== null) people.set(r.actor, personId);
    }
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [...people.values()]);
    const now = Date.parse(deps.clock.instant());

    const items: TransferView[] = [];
    for (const r of shown) {
      items.push({
        id: r.id,
        kind: r.kind,
        title: r.kind === 'import' ? r.name : (r.reason ?? r.fileNames?.[0] ?? null),
        by: {
          name: named({ kind: 'user', userId: r.actor }),
          avatarUrl: avatars.get(people.get(r.actor) ?? '') ?? null,
        },
        at: r.at,
        imported:
          r.kind === 'import' && r.counts !== null
            ? {
                created: r.counts.created,
                updated: r.counts.updated,
                blocked: r.counts.blocked + r.counts.duplicate,
              }
            : null,
        exported:
          r.kind === 'export' && r.rowCount !== null
            ? { rows: r.rowCount, format: r.format }
            : null,
        downloadable:
          r.kind === 'export' &&
          r.actor === asking.viewer.accountId &&
          r.fileNames !== null &&
          r.expiresAt !== null &&
          Date.parse(r.expiresAt) > now,
        reportUrl: await reportLink(deps, asking.tenantId, r, now),
      });
    }
    return ok({
      items,
      next: rows.length > limit ? (shown.at(-1)?.id ?? null) : null,
    });
  });
}

/** A day's link to an import's kept report, never outliving it; null when none is kept. */
async function reportLink(
  deps: TransferDeps,
  tenantId: string,
  r: TransferRow,
  now: number,
): Promise<string | null> {
  if (
    deps.reports === undefined ||
    r.checksum === null ||
    r.reportExpiresAt === null ||
    Date.parse(r.reportExpiresAt) <= now
  ) {
    return null;
  }
  const until = Math.min(now + REPORT_LINK_MS, Date.parse(r.reportExpiresAt));
  return deps.reports.sign(reportKey(tenantId, r.checksum), new Date(until).toISOString());
}

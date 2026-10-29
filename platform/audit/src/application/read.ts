import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { mayRead, PAGE, type Filter } from '../domain/reading.js';
import type { EntryStore, Readers, StoredEntry } from './ports.js';

/**
 * The log, for somebody allowed to read it.
 *
 * Checked here, whichever transport asked: a rule that lives in a resolver is
 * a rule that leaks. Kithena support needs no lookup — it is a full
 * administrator at the company it signed in to, and holds no tuple.
 */

export interface Reader {
  readonly tenantId: string;
  readonly accountId: string;
  /** Set when this is Kithena support: the operator behind the session. */
  readonly supportOperator: string | null;
}

export interface ActivityPage {
  readonly entries: readonly StoredEntry[];
  /** The cursor for older entries; null when there are none. */
  readonly next: string | null;
  /** How many entries the filter finds over every page, on the first; null on a later one. */
  readonly total: number | null;
}

export const Forbidden = failure(
  'FORBIDDEN',
  'The activity log is for People administrators and HR, and a module’s for its administrators',
);

export function readActivity(deps: {
  readonly store: EntryStore;
  readonly readers: Readers;
}): (
  reader: Reader,
  query: { readonly filter: Filter; readonly before: string | null },
) => Promise<Result<ActivityPage>> {
  return async (reader, query) => {
    const support = reader.supportOperator !== null;
    const [roles, administers] = support
      ? [new Set<string>(), new Set<string>()]
      : await Promise.all([
          deps.readers.roles(reader.tenantId, reader.accountId),
          deps.store.administers(reader.tenantId, reader.accountId),
        ]);
    if (!mayRead({ roles, support, administers }, query.filter.module)) return err(Forbidden);
    const rows = await deps.store.page(reader.tenantId, { ...query, limit: PAGE + 1 });
    const entries = rows.slice(0, PAGE);
    const total =
      query.before !== null
        ? null
        : rows.length <= PAGE
          ? entries.length
          : await deps.store.count(reader.tenantId, query.filter);
    return ok({ entries, next: rows.length > PAGE ? (entries.at(-1)?.id ?? null) : null, total });
  };
}

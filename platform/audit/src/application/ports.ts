import type { Entry } from '../domain/entry.js';
import type { Filter } from '../domain/reading.js';

/** An entry as the log holds it: its own id, and the support sign-in it came from. */
export interface StoredEntry extends Entry {
  readonly id: string;
  /**
   * For an entry by support: the sign-in it happened in, so its reason. The
   * latest by the same operator at the company, started within the hour
   * before (`SUPPORT_SESSION_HOURS`). Null otherwise.
   */
  readonly supportSignIn: {
    readonly entryId: string;
    readonly at: string;
    readonly reason: string | null;
  } | null;
}

export interface EntryStore {
  /** One entry. False when its source event is already in the log. */
  append(entry: Entry): Promise<boolean>;
  /** Newest first: `limit` entries after the entry `before` (its id), as `filter` narrows them. */
  page(
    tenantId: string,
    query: { readonly filter: Filter; readonly before: string | null; readonly limit: number },
  ): Promise<readonly StoredEntry[]>;
}

/** The tenant relations an account holds, from the platform's authorization (OpenFGA). */
export interface Readers {
  roles(tenantId: string, accountId: string): Promise<ReadonlySet<string>>;
}

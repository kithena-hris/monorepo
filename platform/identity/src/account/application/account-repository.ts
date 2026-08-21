import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { Account, AccountSnapshot } from '../domain/account.js';

/**
 * Loading and saving the aggregate, and nothing else.
 *
 * There is no `SessionRepository` beside this one, and that absence is the
 * design rather than an omission. The four-device rule spans every session an
 * account has, so `Account` is the consistency boundary and sessions are saved
 * as part of it. A repository that could write one session on its own would be
 * a way to write a fifth.
 *
 * Both methods take the transaction rather than opening one. The caller owns
 * the transaction because the caller is what has to retry it.
 */
export interface AccountRepository {
  load(tx: PostgresJsDatabase, accountId: string): Promise<AccountSnapshot | null>;

  /**
   * Persist the aggregate and drain its events into the outbox, in the caller's
   * transaction — which is what makes the write and its event atomic.
   *
   * Expected to throw on a unique violation rather than swallow it. The slot
   * index is the last line of the session cap, and a `DO NOTHING` here would
   * turn "somebody beat me to this slot" into "the login silently did nothing".
   */
  save(tx: PostgresJsDatabase, account: Account): Promise<void>;
}

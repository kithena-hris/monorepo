/**
 * The hot copy of a session.
 *
 * Postgres is the truth and this is the speed. The split is not an
 * optimisation for its own sake: the cookie is read on every request in the
 * product, and answering "is this still valid" from the aggregate would mean
 * loading an account and its sessions to answer a yes-or-no question.
 *
 * What this deliberately does NOT hold is the device cap. Counting in a cache
 * and inserting in a database means two answers to one question, and a cache
 * that restarts resets the count to zero while the rows survive — so the limit
 * silently becomes five, then six, and nothing is broken loudly enough to page
 * anyone. The cap lives in `UNIQUE (account_id, slot)` and nowhere else.
 */
export interface CachedSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly tenantId: string;
  readonly identityId: string;
  /** RFC 8176 methods, carried so step-up can be decided without a query. */
  readonly amr: readonly string[];
  /** When the person last proved who they were. Drives step-up freshness. */
  readonly authenticatedAt: string;
  /** Absolute expiry. Not extended by activity. */
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

export interface SessionCache {
  read(sessionId: string): Promise<CachedSession | null>;
  /** `ttlSeconds` bounds how long a revoked session could survive a lost delete. */
  write(session: CachedSession, ttlSeconds: number): Promise<void>;
  forget(sessionId: string): Promise<void>;
}

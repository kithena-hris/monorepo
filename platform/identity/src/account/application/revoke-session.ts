import type { SessionCache } from './session-cache.js';

/**
 * Ending a session, in the order that fails safely.
 *
 * **The cache is cleared first, then the durable row.** That looks backwards
 * and it is deliberate.
 *
 * If the database write then fails, the next request misses the cache, reads
 * Postgres, finds the session alive and puts it back. The revocation simply did
 * not happen, which is true, and the caller gets an error saying so.
 *
 * The other order fails the other way: a successful database delete followed by
 * a failed cache delete leaves a cache serving a session whose row is gone — a
 * logout that did not log anyone out, for as long as the TTL. Between "the
 * operation failed" and "the operation reported success and left the door
 * open", only one of those is acceptable on a revocation path.
 */
export interface RevokeSessionDeps {
  readonly cache: SessionCache;
  /** The durable delete. Expected to throw if it fails. */
  readonly remove: (tenantId: string, sessionId: string) => Promise<void>;
}

export type RevokeSession = (tenantId: string, sessionId: string) => Promise<void>;

export function revokeSession({ cache, remove }: RevokeSessionDeps): RevokeSession {
  return async (tenantId, sessionId) => {
    await cache.forget(sessionId);
    await remove(tenantId, sessionId);
  };
}

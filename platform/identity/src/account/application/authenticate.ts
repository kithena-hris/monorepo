import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import type { CachedSession, SessionCache } from './session-cache.js';

/**
 * Cookie to session, on every request.
 *
 * Three things happen here and the order matters. The tenant comes from the
 * Host header and is passed in — never read from the session — so a cookie
 * lifted from one tenant's browser and replayed against another's hostname is
 * refused here rather than by hoping row-level security notices later. The
 * cache is consulted before the database. And expiry is checked against an
 * injected clock, because "has this been idle for eight hours" is exactly the
 * kind of question that becomes untestable the moment it calls `Date.now()`.
 */

export interface AuthenticateDeps {
  readonly cache: SessionCache;
  /** The durable read, used only on a cache miss. */
  readonly load: (tenantId: string, sessionId: string) => Promise<CachedSession | null>;
  readonly clock: Clock;
  readonly idleTimeoutSeconds?: number;
  /**
   * Called when a valid cookie arrives bearing another tenant's session.
   *
   * Separate from a plain miss on purpose. A wrong session id is a stale
   * cookie; a *valid* session id arriving on the wrong hostname is somebody
   * moving a cookie between origins, and that is worth seeing in a log even
   * though the answer to both is the same refusal.
   */
  readonly onTenantMismatch?: (session: CachedSession, presentedTenantId: string) => void;
}

export type Authenticate = (tenantId: string, sessionId: string) => Promise<Result<CachedSession>>;

const Unauthenticated = failure('UNAUTHENTICATED', 'No valid session');

export function authenticate({
  cache,
  load,
  clock,
  idleTimeoutSeconds = 8 * 60 * 60,
  onTenantMismatch,
}: AuthenticateDeps): Authenticate {
  return async (tenantId, sessionId) => {
    const cached = await cache.read(sessionId);
    const session = cached ?? (await load(tenantId, sessionId));
    if (!session) return err(Unauthenticated);

    if (session.tenantId !== tenantId) {
      onTenantMismatch?.(session, tenantId);
      return err(Unauthenticated);
    }

    const now = clock.now().getTime();
    if (now >= Date.parse(session.expiresAt)) return err(Unauthenticated);

    const idleFor = (now - Date.parse(session.lastSeenAt)) / 1000;
    if (idleFor > idleTimeoutSeconds) return err(Unauthenticated);

    // Repopulate only what was missing. A cache hit writes nothing, so a busy
    // session costs one read rather than a read and a write.
    if (!cached) {
      const remaining = Math.ceil((Date.parse(session.expiresAt) - now) / 1000);
      await cache.write(session, Math.min(remaining, idleTimeoutSeconds));
    }

    return ok(session);
  };
}

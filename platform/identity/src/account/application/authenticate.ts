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
   * Records that the session was used, sliding the idle window.
   *
   * This is what keeps somebody signed in. Without it `lastSeenAt` is frozen at
   * sign-in and the eight-hour idle limit becomes an eight-hour *absolute*
   * limit — a person working all day is thrown out mid-afternoon having done
   * nothing wrong. That was the behaviour before this existed.
   *
   * It deliberately does not touch `expiresAt`. The thirty-day lifetime is
   * measured from sign-in and is **not extendable by activity**, which is the
   * distinction `docs/authentication.md` draws between the two limits: idle
   * ends a forgotten tab, absolute forces a fresh proof of possession however
   * diligent the person has been.
   *
   * The tenant is passed even though the session id alone identifies the row.
   * `platform.session` carries row-level security with FORCE, so an
   * implementation that writes without entering a tenant updates nothing and
   * reports success — which looks exactly like a working sliding window until
   * somebody is signed out eight hours after logging in.
   */
  readonly touch?: (tenantId: string, sessionId: string, at: string) => Promise<void>;
  /**
   * How stale `lastSeenAt` must be before a request pays for a write.
   *
   * Not every request: a session is read on every page, every image and every
   * server action, and writing a row each time turns a primary-key read into a
   * write-amplified hot spot for no benefit. Five minutes is invisible against
   * an eight-hour window and costs at most twelve writes an hour per device.
   */
  readonly touchAfterSeconds?: number;
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
  touch,
  touchAfterSeconds = 5 * 60,
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

    /*
     * The idle window slides, the absolute one does not.
     *
     * Checked *after* the two limits above, so a session that has already
     * lapsed is not resurrected by the request that discovers it.
     */
    let live = session;
    if (touch && idleFor >= touchAfterSeconds) {
      const at = clock.now().toISOString();
      await touch(tenantId, session.sessionId, at);
      live = { ...session, lastSeenAt: at };
    }

    // Repopulate only what was missing, or replace what has just moved on. A
    // cache hit that needed no touch writes nothing, so a busy session costs
    // one read rather than a read and a write.
    if (!cached || live !== session) {
      const remaining = Math.ceil((Date.parse(live.expiresAt) - now) / 1000);
      await cache.write(live, Math.min(remaining, idleTimeoutSeconds));
    }

    return ok(live);
  };
}

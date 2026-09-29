import 'server-only';
import { cookies, headers } from 'next/headers';

import { people } from './people';
import { currentPerson } from './session';
import { RETURN_COOKIE, SESSION_COOKIE } from './session-cookie';

/**
 * Viewing as an employee, in this app: a People administrator swaps their own
 * session for a read-only one as the employee, and back.
 *
 * People decides whether they may and identity makes the session; this app
 * only holds the two cookies. While viewing, `__Host-ksession` is the view-as
 * session and `__Host-kreturn` their own, put aside. Ending — from the account
 * menu, ⌘K, `V`, or the thirty minutes running out — signs the view-as session
 * out in identity (which records the end) and puts their own back; it never
 * leaves this browser signed in as the employee.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What `__Host-kreturn` holds: the administrator's own session, whose profile to go back to, and when theirs ends. */
export interface Return {
  readonly sessionId: string;
  readonly personId: string;
  readonly expiresAt: number;
}

export function returnCookie(r: Return): string {
  return `${r.sessionId}.${r.personId}.${String(r.expiresAt)}`;
}

/** The cookie's value, or null for anything this app did not write. */
export function readReturn(value: string | undefined): Return | null {
  const [sessionId = '', personId = '', expires = ''] = (value ?? '').split('.');
  const expiresAt = Number(expires);
  return UUID.test(sessionId) && UUID.test(personId) && Number.isFinite(expiresAt)
    ? { sessionId, personId, expiresAt }
    : null;
}

interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly expires?: Date;
  readonly maxAge?: number;
}

/** As the session cookie is set (`auth/callback`): `__Host-` needs Secure and `/`. */
const cookie = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  ...(expires === undefined ? {} : { expires }),
});

async function identity(path: string, body: Record<string, unknown>): Promise<Response | null> {
  return fetch(`${process.env['INTERNAL_API_URL'] ?? ''}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  }).catch(() => null);
}

/**
 * Start viewing as `personId`, from a server action: People's answer when it
 * refuses, and the cookies swapped when it does not.
 */
export async function startViewing(
  personId: string,
  reason: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const me = await currentPerson();
  const jar = await cookies();
  const own = jar.get(SESSION_COOKIE)?.value;
  const tenantId = (await headers()).get('x-tenant-id');
  if (me === null || own === undefined || tenantId === null || !UUID.test(personId)) {
    return { ok: false, message: 'Sign in again' };
  }
  // People refuses it too; this only saves the round trip.
  if (me.viewing !== null) return { ok: false, message: 'End this view first' };

  const started = await people<{ code: string }>('StartViewingAs', { personId, reason });
  if (!started.ok) return { ok: false, message: started.message };

  const redeemed = await identity('/api/internal/handoff/redeem', {
    code: started.data.code,
    tenantId,
  });
  const body = (await redeemed?.json().catch(() => null)) as {
    sessionId?: unknown;
    expiresAt?: unknown;
  } | null;
  if (!redeemed?.ok || typeof body?.sessionId !== 'string' || typeof body.expiresAt !== 'string') {
    return { ok: false, message: 'Viewing as them could not be started. Try again.' };
  }
  const ownEnd = me.expiresAt === null ? Date.now() + 86_400_000 : Date.parse(me.expiresAt);
  jar.set(
    RETURN_COOKIE,
    returnCookie({ sessionId: own, personId, expiresAt: ownEnd }),
    cookie(new Date(ownEnd)),
  );
  // Gone with the view-as session, so a browser left alone drops it at thirty minutes.
  jar.set(SESSION_COOKIE, body.sessionId, cookie(new Date(body.expiresAt)));
  return { ok: true };
}

/**
 * Sign the view-as session out (identity records the end) and put the
 * administrator's own session back, or none: a response's cookies, and where
 * to go — the profile they started from, or sign-in when their own session is
 * gone too. Called with no return cookie, it changes nothing.
 */
export async function endViewing(): Promise<{
  readonly to: string;
  readonly set: readonly { name: string; value: string; options: CookieOptions }[];
}> {
  const jar = await cookies();
  const tenantId = (await headers()).get('x-tenant-id');
  const raw = jar.get(RETURN_COOKIE)?.value;
  if (raw === undefined) return { to: '/', set: [] };
  const back = readReturn(raw);
  const current = jar.get(SESSION_COOKIE)?.value;

  // The view-as session, never the administrator's own: signed out whatever
  // else happens, before either cookie changes.
  if (current !== undefined && current !== '' && current !== back?.sessionId && tenantId !== null) {
    await identity('/api/internal/session/revoke', { sessionId: current, tenantId });
  }
  const gone = { name: RETURN_COOKIE, value: '', options: { ...cookie(), maxAge: 0 } };
  if (back === null || back.expiresAt <= Date.now()) {
    return {
      to: '/login',
      set: [gone, { name: SESSION_COOKIE, value: '', options: { ...cookie(), maxAge: 0 } }],
    };
  }
  return {
    to: `/people/${back.personId}`,
    set: [
      gone,
      { name: SESSION_COOKIE, value: back.sessionId, options: cookie(new Date(back.expiresAt)) },
    ],
  };
}

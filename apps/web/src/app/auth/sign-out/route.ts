import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '../../../lib/session';

/**
 * Signing out.
 *
 * `POST` only. Ending a session is a state change, and a `GET` that does it is
 * one a link prefetcher, an email scanner or an `<img src>` can fire — which is
 * how people get logged out by opening a message.
 *
 * Both halves happen here now. The cookie is cleared, which ends this browser's
 * access, and the row is revoked through identity, which ends everyone's — a
 * cookie copied to another machine stops working at the same moment. This route
 * used to do only the first and said so in a comment; that gap is closed.
 */
export async function POST(): Promise<Response> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  const tenantId = (await headers()).get('x-tenant-id');

  /*
   * Revoked first, cleared second.
   *
   * If revocation fails the cookie is still cleared — the person asked to be
   * signed out and must end up signed out on this device whatever else broke.
   * The reverse order would mean a failure between the two steps leaves a
   * browser holding a cookie for a session that is still live.
   */
  if (sessionId !== undefined && sessionId !== '' && tenantId !== null && tenantId !== '') {
    await fetch(`${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/session/revoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      body: JSON.stringify({ sessionId, tenantId }),
      cache: 'no-store',
      // Swallowed on purpose. A person who clicked "sign out" gets signed out
      // of this browser even if identity is unreachable; the row then lapses on
      // its own absolute lifetime. Failing the request would leave them looking
      // at an error while still signed in.
    }).catch(() => null);
  }

  /*
   * A relative `Location`, never one built from `request.url`.
   *
   * That reports the host the server is bound to — `localhost:3000` — not the
   * `acme.app.localhost:3000` the browser asked for, so an absolute redirect
   * drops the tenant label and lands on a host the proxy 404s. A relative one
   * is resolved by the browser against the URL it requested, so the hostname
   * survives by construction.
   *
   * 303, so the browser follows with GET rather than repeating the POST.
   */
  const response = new NextResponse(null, { status: 303, headers: { location: '/' } });

  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}

import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { RETURN_COOKIE, SESSION_COOKIE } from '../../../lib/session-cookie';

/**
 * Where a sign-in that happened on the auth origin lands.
 *
 * The browser arrives here carrying a one-time code and nothing else. This
 * exchanges it for the session over a back channel the browser is not part of,
 * sets the cookie that belongs to this hostname, and sends the person on to
 * their dashboard.
 *
 * It is a GET because it is the target of a redirect, which is the one thing a
 * browser will only ever do as a GET. That normally rules out changing state
 * here, and the reasons it is acceptable are specific: the code is single-use
 * and spent by the exchange, so a repeat is inert; it lives 60 seconds; and it
 * cannot be planted, because a code is bound to the company that may spend it
 * and this route takes that company from its own hostname rather than from
 * anything in the URL.
 *
 * **Arriving replaces whoever was here.** A browser that already holds a
 * session on this host has it ended in identity, not merely overwritten: the
 * back office's "Sign in as support" lands here in an operator's browser that
 * may hold somebody's own session, and two live sessions behind one cookie jar
 * is one too many.
 */
export async function GET(request: Request): Promise<Response> {
  // Only the query string is read from here. See `seeOther` below for why the
  // host this reports must not be used to build a redirect.
  const code = new URL(request.url).searchParams.get('code') ?? '';

  // The tenant from the proxy, never from the query string. `proxy.ts` resolves
  // it from the hostname and deletes any inbound copy first, so this is the one
  // value in the request a caller could not have chosen.
  const tenantId = (await headers()).get('x-tenant-id');

  /*
   * Relative `Location`, never `new URL(path, request.url)`.
   *
   * `request.url` is reconstructed by the server and reports the host it is
   * bound to — `localhost:3000` — not the `acme.app.localhost:3000` the browser
   * asked for. Building an absolute redirect from it therefore drops the tenant
   * label, and the proxy 404s the bare host with an empty body: a blank page at
   * the end of a sign-in that actually succeeded.
   *
   * A relative `Location` is resolved by the browser against the URL it
   * requested, so the hostname survives by construction rather than by this
   * route reassembling it correctly. It also keeps working behind a proxy that
   * rewrites the host, which is the deployed shape.
   */
  const seeOther = (path: string): NextResponse =>
    new NextResponse(null, { status: 303, headers: { location: path } });

  /*
   * Failures all land on the sign-in page rather than rendering an error.
   *
   * An expired code is the ordinary outcome of leaving a tab open, and the
   * useful response to it is the button that starts again — not a page
   * explaining what a handoff code is.
   */
  const giveUp = seeOther('/signed-out');

  if (code === '' || tenantId === null || tenantId === '') return giveUp;

  const redeemed = await fetch(
    `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/handoff/redeem`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      body: JSON.stringify({ code, tenantId }),
      cache: 'no-store',
    },
  ).catch(() => null);

  if (!redeemed?.ok) return giveUp;

  const body = (await redeemed.json()) as { sessionId?: unknown; expiresAt?: unknown };
  if (typeof body.sessionId !== 'string' || body.sessionId === '') return giveUp;
  const expires = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null;

  /*
   * The session this browser had here, ended before the new one is set.
   *
   * After the redemption rather than before, so a stale or replayed code signs
   * nobody out. Swallowed like the sign-out route's: the cookie is replaced
   * either way, and the old row then lapses on its own lifetime.
   */
  const jar = await cookies();
  // And an administrator's own session put aside while viewing as somebody:
  // arriving replaces both, and ends the view (identity records it).
  const aside = jar.get(RETURN_COOKIE)?.value.split('.')[0];
  for (const previous of [jar.get(SESSION_COOKIE)?.value, aside]) {
    if (previous === undefined || previous === '' || previous === body.sessionId) continue;
    await fetch(`${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/session/revoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      body: JSON.stringify({ sessionId: previous, tenantId }),
      cache: 'no-store',
    }).catch(() => null);
  }

  /*
   * `__Host-` is a promise the browser keeps rather than one a reviewer has to
   * notice: it forbids a `Domain` attribute outright, so this cookie belongs to
   * this one hostname and a sibling subdomain cannot be sent it. `Secure` and
   * `Path=/` are what the prefix requires.
   *
   * `Secure` over plain HTTP would normally be refused, which is why local
   * development uses `*.localhost` — browsers treat it as a trustworthy origin.
   */
  const landed = seeOther('/');
  landed.cookies.set(SESSION_COOKIE, body.sessionId, {
    httpOnly: true,
    secure: true,
    // `Lax`, not `Strict`: this cookie is set on a cross-site navigation from
    // the auth origin and must survive the redirect that follows it. `Strict`
    // would be dropped on exactly the hop that matters and the dashboard would
    // bounce straight back to sign-in.
    sameSite: 'lax',
    path: '/',
    // Gone when the session is: an hour for support, thirty days for a person.
    // Without it the cookie lived as long as the browser did, pointing at a
    // session identity had long since refused.
    ...(expires === null || Number.isNaN(expires.getTime()) ? {} : { expires }),
  });

  if (aside !== undefined) {
    landed.cookies.set(RETURN_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }
  return landed;
}

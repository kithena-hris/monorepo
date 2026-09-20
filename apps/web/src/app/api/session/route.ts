import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { ceremonyOrigin } from '../../../lib/ceremony-origin';
import { SESSION_COOKIE } from '../../../lib/session';

/**
 * Turning a completed passkey assertion into a session on this origin.
 *
 * This is the half of signing in a browser cannot do. The assertion happens in
 * the page — it needs `navigator.credentials` — but the verification needs the
 * internal token, and the cookie has to be set by whatever holds this hostname.
 * Both are true here and nowhere else.
 *
 * No handoff, and none is needed. `docs/authentication.md` records that
 * `app.kithena.com` is a registrable suffix of `acme.app.kithena.com`, so the
 * relying-party id is legal here and the ceremony can finish on the company's
 * own origin — which is also the origin the cookie belongs to. The handoff
 * exists for the case that cannot work this way: Google requires every redirect
 * URI registered exactly, so its callback is forced onto one central host.
 *
 * **The tenant comes from the proxy, never from the body.** `proxy.ts` resolves
 * it from the hostname and deletes any inbound copy first, so a client cannot
 * ask for a session at a company it does not belong to by editing a payload.
 */
export async function POST(request: Request): Promise<Response> {
  const inbound = await headers();
  const tenantId = inbound.get('x-tenant-id');
  if (tenantId === null || tenantId === '') {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const origin = ceremonyOrigin(inbound);
  if (origin === null) return NextResponse.json({ ok: false }, { status: 400 });

  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object' || !('response' in body)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const verified = await fetch(
    `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/webauthn/authenticate/finish`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      body: JSON.stringify({
        tenantId,
        /*
         * The address the person typed, passed through unchecked.
         *
         * It narrows, it never authorises: identity applies it *after* the
         * assertion verifies, and only to remove candidates the verified passkey
         * already produced. A caller cannot reach an account their passkey does
         * not hold by putting a different address here.
         */
        ...(typeof Reflect.get(body, 'workEmail') === 'string'
          ? { workEmail: Reflect.get(body, 'workEmail') as string }
          : {}),
        // The origin as this server knows it, not as the page reported it. It
        // is one of the three things the assertion is checked against, and a
        // value taken from the request body is a value the caller chose.
        //
        // Built from the host the proxy already resolved a tenant from, not
        // from `request.url` — see `ceremonyOrigin` for the failure that was.
        origin,
        response: body.response,
        // A browser cannot see its own network address. Whatever terminates the
        // connection supplies one or nothing does — never a placeholder, which
        // is what once put the literal 'unknown' into an `inet` column.
        device: { userAgent: request.headers.get('user-agent') ?? '' },
      }),
      cache: 'no-store',
    },
  ).catch(() => null);

  if (!verified?.ok) {
    // One answer for every refusal. Anybody can present a passkey here, so
    // separating "wrong passkey" from "no account at this company" would answer
    // a question that is not the asker's to ask.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const session = (await verified.json()) as { sessionId?: unknown; expiresAt?: unknown };
  if (typeof session.sessionId !== 'string' || session.sessionId === '') {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const landed = NextResponse.json({ ok: true });

  /*
   * `__Host-` is a promise the browser keeps rather than one a reviewer has to
   * notice: it forbids a `Domain` attribute outright, so this cookie belongs to
   * this one hostname and `evil.app.kithena.com` cannot be sent it. `Secure`
   * and `Path=/` are what the prefix requires.
   *
   * `Secure` over plain HTTP would normally be refused, which is why local
   * development uses `*.localhost` — browsers treat it as trustworthy.
   */
  landed.cookies.set(SESSION_COOKIE, session.sessionId, {
    httpOnly: true,
    secure: true,
    // `Strict` is safe here and `Lax` is not needed: this cookie is set by a
    // same-origin fetch and every later request to it is same-site. Nothing
    // about signing in requires arriving from another site.
    sameSite: 'strict',
    path: '/',
    /*
     * Until the session row expires, and not a moment more.
     *
     * Without this it was a *browser-session* cookie: discarded when the window
     * closed, whatever the thirty-day row behind it said. So "stay signed in
     * for thirty days" held until somebody quit their browser, which is the one
     * thing everybody does — the row outlived the cookie that pointed at it and
     * the next visit looked like a sign-out nobody asked for.
     *
     * Taken from the session identity issued rather than restated here, so the
     * cookie and the row cannot disagree about when this ends. A cookie that
     * outlives its row is a request that fails the session check; one that dies
     * first is this bug.
     */
    expires:
      typeof session.expiresAt === 'string' && !Number.isNaN(Date.parse(session.expiresAt))
        ? new Date(session.expiresAt)
        : undefined,
  });

  return landed;
}

import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '../../../lib/session';

/**
 * Signing out.
 *
 * `POST` only. Ending a session is a state change, and a `GET` that does it is
 * one a link prefetcher, an email scanner or a `<img src>` can fire — which is
 * how people get logged out by opening a message.
 *
 * The cookie is cleared here whatever else happens. Revoking the row is the
 * durable half and belongs behind identity's own endpoint; until that exists,
 * clearing the cookie ends this browser's access and the session expires on its
 * own absolute lifetime. That gap is worth naming rather than hiding: a stolen
 * cookie is not invalidated by this.
 */
export function POST(): NextResponse {
  const response = NextResponse.redirect(
    new URL('/', process.env['APP_ORIGIN'] ?? 'http://localhost:3000'),
    // 303, so the browser follows with GET rather than repeating the POST.
    { status: 303 },
  );

  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}

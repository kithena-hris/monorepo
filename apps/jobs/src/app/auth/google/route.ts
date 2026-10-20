import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Signing in with Google: the trip out. Where it came from and a nonce are
 * written in a short cookie, and the browser is sent to Google; the callback
 * takes Google's answer and asks Recruiting to vouch for it. The client id is
 * this site's own; Recruiting checks the token against the same id.
 */

export const STATE_COOKIE = 'kj_google_state';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';

export function GET(request: NextRequest): NextResponse {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  if (!clientId) return NextResponse.redirect(new URL('/sign-in?error=google', request.url));
  const origin = process.env['JOBS_ORIGIN'] ?? request.nextUrl.origin;
  const next = request.nextUrl.searchParams.get('next') ?? '/me';
  const state = randomBytes(16).toString('base64url');
  const to = new URL(AUTHORIZE);
  to.searchParams.set('client_id', clientId);
  to.searchParams.set('redirect_uri', `${origin}/auth/google/callback`);
  to.searchParams.set('response_type', 'code');
  to.searchParams.set('scope', 'openid email profile');
  to.searchParams.set('state', state);
  to.searchParams.set('prompt', 'select_account');
  const response = NextResponse.redirect(to);
  response.cookies.set({
    name: STATE_COOKIE,
    value: `${state}.${next.startsWith('/') ? next : '/me'}`,
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/auth/google',
    maxAge: 600,
  });
  return response;
}

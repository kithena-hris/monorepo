import { NextResponse, type NextRequest } from 'next/server';

import { accountCall } from '../../../../lib/account';
import { STATE_COOKIE } from '../route';
import { setSession } from '../../sign-in/route';

const TOKEN = 'https://oauth2.googleapis.com/token';

/** Google's answer: the code becomes an ID token here, and Recruiting vouches for it. Every refusal goes back to sign-in. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/sign-in?error=${reason}`, request.url));
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return back('google');
  const kept = request.cookies.get(STATE_COOKIE)?.value ?? '';
  const dot = kept.indexOf('.');
  const state = dot < 0 ? kept : kept.slice(0, dot);
  const next = dot < 0 ? '/me' : kept.slice(dot + 1);
  const code = request.nextUrl.searchParams.get('code');
  if (state === '' || request.nextUrl.searchParams.get('state') !== state || code === null)
    return back('google');
  const origin = process.env['JOBS_ORIGIN'] ?? request.nextUrl.origin;
  let idToken = '';
  try {
    const exchanged = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!exchanged.ok) return back('google');
    const tokens = (await exchanged.json()) as { id_token?: unknown };
    idToken = typeof tokens.id_token === 'string' ? tokens.id_token : '';
  } catch {
    return back('google');
  }
  if (idToken === '') return back('google');
  const answer = await accountCall<{ token: string; expiresAt: string }>('/google', {
    method: 'POST',
    body: { idToken },
    token: '',
  });
  if (!answer.ok) return back('google');
  const response = NextResponse.redirect(new URL(next, request.url));
  setSession(response, answer.data.token, answer.data.expiresAt);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

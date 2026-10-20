import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, accountCall } from '../../../lib/account';

const SESSION_DAYS = 90;

/** The session cookie: readable by the page's own scripts, which call Recruiting directly for a CV. */
export function setSession(response: NextResponse, token: string, expiresAt: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: false,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
    maxAge: SESSION_DAYS * 86_400,
  });
}

/** The code, against the account's: a session cookie when it is right. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const input = (await request.json().catch(() => null)) as {
    email?: unknown;
    code?: unknown;
  } | null;
  const email = typeof input?.email === 'string' ? input.email.trim() : '';
  const code = typeof input?.code === 'string' ? input.code.trim() : '';
  const answer = await accountCall<{ token: string; expiresAt: string }>('/sign-in', {
    method: 'POST',
    body: { email, code },
    token: '',
  });
  if (!answer.ok)
    return NextResponse.json({ error: { message: answer.message } }, { status: answer.status });
  const response = NextResponse.json({ ok: true });
  setSession(response, answer.data.token, answer.data.expiresAt);
  return response;
}

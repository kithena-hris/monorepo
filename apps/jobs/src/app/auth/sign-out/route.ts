import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, accountCall } from '../../../lib/account';

/** Ends the session at Recruiting and on this host. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  await accountCall('/sign-out', { method: 'POST' });
  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

import { NextResponse } from 'next/server';

import { endViewing } from '../../../../lib/view-as';

/**
 * Ending a view as somebody: "End viewing as …" in the account menu or ⌘K,
 * `V`, or the page finding the view-as session gone (its thirty minutes up).
 *
 * The view-as session is signed out in identity, which records the end, and
 * the administrator's own session is put back — or none, if theirs has gone
 * too. Never the employee's: this browser leaves here signed in as the
 * administrator or not at all.
 *
 * `GET` as well as `POST`, deliberately: the page that finds the view over
 * redirects here, and all a forged request can do is end a view early, which
 * is the safe direction. With no view to end it changes nothing.
 */
async function end(): Promise<Response> {
  const { to, set } = await endViewing();
  // Relative, as `auth/callback` explains: the browser keeps the tenant's host.
  const response = new NextResponse(null, { status: 303, headers: { location: to } });
  for (const c of set) response.cookies.set(c.name, c.value, c.options);
  return response;
}

export const GET = end;
export const POST = end;

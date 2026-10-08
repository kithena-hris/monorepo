import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { peopleFor } from '../../../../lib/people';
import { personFor } from '../../../../lib/session';

/**
 * A calendar feed for the phone app: Time Off issues the token
 * (`IssueTimeOffCalendarFeed`, as the person whose session the bearer names)
 * and this answers with the feed's address, built from the same settings as
 * the web's two subscribe actions — the person's own feed, or a team's or
 * the company's. The phone opens it as `webcal:` so the calendar app
 * subscribes.
 */
const NO_STORE = { 'cache-control': 'no-store' };
const SCOPES = new Set(['me', 'team', 'company']);

export async function POST(request: Request): Promise<Response> {
  const tenantId = (await headers()).get('x-tenant-id');
  const bearer = request.headers.get('authorization') ?? '';
  const sessionId = /^Bearer \S+$/.test(bearer) ? bearer.slice('Bearer '.length) : null;
  if (tenantId === null || tenantId === '' || sessionId === null) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const scope: unknown =
    body !== null && typeof body === 'object' ? Reflect.get(body, 'scope') : undefined;
  if (typeof scope !== 'string' || !SCOPES.has(scope)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  if ((await personFor(sessionId, tenantId)) === null) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const answer = await peopleFor(sessionId, tenantId, 'timeoff', 'IssueTimeOffCalendarFeed', {
    input: { scope },
  });
  if (!answer.ok) {
    const status = answer.code === 'UNAUTHENTICATED' ? 401 : 200;
    return NextResponse.json(answer, { status, headers: NO_STORE });
  }
  const token = encodeURIComponent((answer.data as { token: string }).token);
  const url =
    scope === 'me'
      ? `${(process.env['TIMEOFF_PUBLIC_URL'] ?? 'http://localhost:4002').replace(/\/$/, '')}/v1/timeoff/calendar/feed.ics?token=${token}`
      : `${process.env['TIMEOFF_FEED_BASE'] ?? 'http://localhost:4002/v1/timeoff/calendar/feed.ics'}?token=${token}`;
  return NextResponse.json({ ok: true, data: { url } }, { headers: NO_STORE });
}

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { peopleFor, writes } from '../../../../lib/people';
import { personFor } from '../../../../lib/session';

/**
 * People and Time Off, for the phone app: one operation per request, by name,
 * as the person whose session the bearer names (`lib/people.ts`, `peopleFor`).
 *
 * The app sends `{ area, operation, variables }` and gets back what a screen
 * on the web gets, `{ ok, data }` or `{ ok: false, code, message }`. Nothing
 * here decides who may see what: People does, from the principal the router
 * builds out of identity's token. The tenant is the hostname's, as everywhere.
 */
const NO_STORE = { 'cache-control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const tenantId = (await headers()).get('x-tenant-id');
  const bearer = request.headers.get('authorization') ?? '';
  const sessionId = /^Bearer \S+$/.test(bearer) ? bearer.slice('Bearer '.length) : null;
  if (tenantId === null || tenantId === '' || sessionId === null) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const read = (key: string): unknown =>
    body !== null && typeof body === 'object' ? Reflect.get(body, key) : undefined;
  const area = read('area') === 'timeoff' ? 'timeoff' : 'people';
  const operation = read('operation');
  const variables: unknown = read('variables') ?? {};
  if (typeof operation !== 'string' || typeof variables !== 'object' || variables === null) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }

  // Somebody, still: a write is sent only once identity has said so. A read
  // travels with that check rather than after it, a round trip off every
  // screen, and its answer is dropped unread unless the check passes — as
  // the web's reads are (`lib/people.ts`, `send`).
  const someone = personFor(sessionId, tenantId);
  const ask = () =>
    peopleFor(sessionId, tenantId, area, operation, variables as Record<string, unknown>);
  let answer: Awaited<ReturnType<typeof ask>>;
  if (writes(area, operation)) {
    if ((await someone) === null) {
      return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    answer = await ask();
  } else {
    const [person, read] = await Promise.all([someone, ask()]);
    if (person === null) {
      return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    answer = read;
  }
  const status = !answer.ok && answer.code === 'UNAUTHENTICATED' ? 401 : 200;
  return NextResponse.json(answer, { status, headers: NO_STORE });
}

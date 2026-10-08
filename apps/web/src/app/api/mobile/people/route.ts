import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { peopleFor } from '../../../../lib/people';
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

  // Somebody, still, before anything is minted for them.
  if ((await personFor(sessionId, tenantId)) === null) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const answer = await peopleFor(
    sessionId,
    tenantId,
    area,
    operation,
    variables as Record<string, unknown>,
  );
  const status = !answer.ok && answer.code === 'UNAUTHENTICATED' ? 401 : 200;
  return NextResponse.json(answer, { status, headers: NO_STORE });
}

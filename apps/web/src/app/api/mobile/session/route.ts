import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { openCode } from '../../../../lib/app-sign-in';
import { personFor, revokeSession } from '../../../../lib/session';

/**
 * The phone app's session, at this company.
 *
 * `POST` finishes a sign-in: the app hands back the sealed code its sign-in
 * sheet was sent to and the verifier only it holds (`lib/app-sign-in.ts`), and
 * gets the session id to keep in the device's keychain. `GET` says who that
 * session is, `DELETE` ends it. After `POST` the app presents the id as a
 * bearer: it has no cookie jar of its own.
 *
 * **The tenant comes from the proxy, never from the body**, exactly as on the
 * web: a session is only ever looked up at the company whose hostname the
 * app is talking to, and identity refuses one that belongs to another.
 *
 * One answer for every refusal, as everywhere else in signing in.
 */
const NO_STORE = { 'cache-control': 'no-store' };
const refused = (): NextResponse =>
  NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });

async function tenantOf(): Promise<string | null> {
  const id = (await headers()).get('x-tenant-id');
  return id === null || id === '' ? null : id;
}

function bearerOf(request: Request): string | null {
  const value = request.headers.get('authorization') ?? '';
  return /^Bearer \S+$/.test(value) ? value.slice('Bearer '.length) : null;
}

export async function POST(request: Request): Promise<Response> {
  const tenantId = await tenantOf();
  const body: unknown = await request.json().catch(() => null);
  const read = (key: string): string =>
    body !== null && typeof body === 'object' && typeof Reflect.get(body, key) === 'string'
      ? (Reflect.get(body, key) as string)
      : '';
  if (tenantId === null) return NextResponse.json({ ok: false }, { status: 400 });

  const code = openCode(read('code'), read('verifier'), process.env['INTERNAL_API_TOKEN'] ?? '');
  if (code === null) return refused();

  const redeemed = await fetch(
    `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/handoff/redeem`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      body: JSON.stringify({ code, tenantId }),
      cache: 'no-store',
    },
  ).catch(() => null);
  if (redeemed?.ok !== true) return refused();

  const { sessionId } = (await redeemed.json()) as { sessionId?: unknown };
  if (typeof sessionId !== 'string' || sessionId === '') return refused();

  const person = await personFor(sessionId, tenantId);
  if (person === null) return refused();

  return NextResponse.json({ sessionId, person }, { headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  const tenantId = await tenantOf();
  const sessionId = bearerOf(request);
  if (tenantId === null || sessionId === null) return refused();

  const person = await personFor(sessionId, tenantId);
  return person === null ? refused() : NextResponse.json(person, { headers: NO_STORE });
}

export async function DELETE(request: Request): Promise<Response> {
  const tenantId = await tenantOf();
  const sessionId = bearerOf(request);
  if (tenantId !== null && sessionId !== null) await revokeSession(sessionId, tenantId);
  // Signed out on the device whatever happened here; the app forgets the id.
  return new NextResponse(null, { status: 204 });
}

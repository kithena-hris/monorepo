import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { peopleFor } from '../../../../lib/people';
import { personFor, revokeSession } from '../../../../lib/session';

/**
 * Viewing the app as somebody, from the phone (`lib/view-as.ts` is the web's).
 *
 * `POST { personId, reason }` with the administrator's bearer: People decides
 * whether they may (`StartViewingAs`) and hands back a one-time code, which
 * identity turns into a thirty-minute, read-only session that is that
 * person's. The app keeps its own session aside and presents this one until
 * the view ends. `DELETE` with the view's bearer ends it in identity.
 *
 * The browser does the same with two cookies; the phone holds both ids in its
 * keychain instead, so nothing here sets a cookie.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'cache-control': 'no-store' };

function bearerOf(request: Request): string | null {
  const value = request.headers.get('authorization') ?? '';
  return /^Bearer \S+$/.test(value) ? value.slice('Bearer '.length) : null;
}

async function tenantOf(): Promise<string | null> {
  const id = (await headers()).get('x-tenant-id');
  return id === null || id === '' ? null : id;
}

export async function POST(request: Request): Promise<Response> {
  const tenantId = await tenantOf();
  const sessionId = bearerOf(request);
  if (tenantId === null || sessionId === null) {
    return NextResponse.json({ ok: false, message: 'Sign in again' }, { status: 401 });
  }
  const me = await personFor(sessionId, tenantId);
  if (me === null)
    return NextResponse.json({ ok: false, message: 'Sign in again' }, { status: 401 });
  // People refuses it too; this only saves the round trip.
  if (me.viewing !== null) {
    return NextResponse.json({ ok: false, message: 'End this view first' }, { status: 409 });
  }

  const body: unknown = await request.json().catch(() => null);
  const read = (key: string): string =>
    body !== null && typeof body === 'object' && typeof Reflect.get(body, key) === 'string'
      ? (Reflect.get(body, key) as string)
      : '';
  const personId = read('personId');
  const reason = read('reason').trim();
  if (!UUID.test(personId) || reason === '') {
    return NextResponse.json({ ok: false, message: 'Say why.' }, { status: 400 });
  }

  const started = await peopleFor(sessionId, tenantId, 'people', 'StartViewingAs', {
    personId,
    reason,
  });
  if (!started.ok) {
    return NextResponse.json({ ok: false, message: started.message }, { headers: NO_STORE });
  }
  const code: unknown = Reflect.get(started.data as object, 'code');

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
  const view = (await redeemed?.json().catch(() => null)) as {
    sessionId?: unknown;
    expiresAt?: unknown;
  } | null;
  if (redeemed?.ok !== true || typeof view?.sessionId !== 'string') {
    return NextResponse.json(
      { ok: false, message: 'Viewing as them could not be started. Try again.' },
      { headers: NO_STORE },
    );
  }
  const person = await personFor(view.sessionId, tenantId);
  return NextResponse.json({ ok: true, sessionId: view.sessionId, person }, { headers: NO_STORE });
}

export async function DELETE(request: Request): Promise<Response> {
  const tenantId = await tenantOf();
  const sessionId = bearerOf(request);
  if (tenantId !== null && sessionId !== null) {
    const view = await personFor(sessionId, tenantId);
    // Only a view-as session is ended here: never the administrator's own.
    if (view?.viewing != null) await revokeSession(sessionId, tenantId);
  }
  return new NextResponse(null, { status: 204 });
}

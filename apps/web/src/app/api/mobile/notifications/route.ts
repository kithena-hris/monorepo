import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { Notifications, notificationsOf } from '../../../../lib/inbox/notifications';
import { readPreferenceFor, writePreferenceFor } from '../../../../lib/preferences';
import { personFor } from '../../../../lib/session';

/**
 * Me › Settings › Notifications on the phone (M:I1): the same preference the
 * web's Settings › Notifications keeps, for the account the bearer names.
 */
const NO_STORE = { 'cache-control': 'no-store' };

async function who(request: Request) {
  const tenantId = (await headers()).get('x-tenant-id');
  const bearer = request.headers.get('authorization') ?? '';
  const sessionId = /^Bearer \S+$/.test(bearer) ? bearer.slice('Bearer '.length) : null;
  if (tenantId === null || tenantId === '' || sessionId === null) return null;
  const person = await personFor(sessionId, tenantId);
  return person === null ? null : { tenantId, sessionId, accountId: person.accountId };
}

export async function GET(request: Request): Promise<Response> {
  const found = await who(request);
  if (found === null)
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  const value = await readPreferenceFor(found.tenantId, found.accountId, 'notifications');
  return NextResponse.json({ ok: true, data: notificationsOf(value) }, { headers: NO_STORE });
}

export async function PUT(request: Request): Promise<Response> {
  const found = await who(request);
  if (found === null)
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  const parsed = Notifications.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  const saved = await writePreferenceFor(
    found.tenantId,
    found.accountId,
    found.sessionId,
    'notifications',
    parsed.data,
  );
  return NextResponse.json(
    saved === 'saved'
      ? { ok: true, data: parsed.data }
      : {
          ok: false,
          code: saved === 'view_only' ? 'VIEW_ONLY' : 'UNAVAILABLE',
          message:
            saved === 'view_only'
              ? 'Viewing as somebody is read-only'
              : 'That did not save; try again',
        },
    { headers: NO_STORE },
  );
}

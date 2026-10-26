import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import * as z from 'zod';

import { readPreferenceFor, writePreferenceFor } from '../../../../lib/preferences';
import { devicesOf, withDevice, withoutDevice } from '../../../../lib/push/devices';
import { personFor } from '../../../../lib/session';

/**
 * This phone, pushed to (Me › Settings › Notifications): the app's Expo push
 * token kept with the account the bearer names, beside the browsers in the
 * same `push` preference. `DELETE` forgets it, as signing out does.
 */
const NO_STORE = { 'cache-control': 'no-store' };

const Body = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]{1,200}\]$/u),
  label: z.string().max(80).default('Phone'),
});

async function who(request: Request) {
  const tenantId = (await headers()).get('x-tenant-id');
  const bearer = request.headers.get('authorization') ?? '';
  const sessionId = /^Bearer \S+$/.test(bearer) ? bearer.slice('Bearer '.length) : null;
  if (tenantId === null || tenantId === '' || sessionId === null) return null;
  const person = await personFor(sessionId, tenantId);
  return person === null ? null : { tenantId, sessionId, accountId: person.accountId };
}

async function change(request: Request, keep: boolean): Promise<Response> {
  const found = await who(request);
  if (found === null)
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  const devices = devicesOf(await readPreferenceFor(found.tenantId, found.accountId, 'push'));
  const saved = await writePreferenceFor(found.tenantId, found.accountId, found.sessionId, 'push', {
    devices: keep
      ? withDevice(devices, {
          kind: 'expo',
          token: body.data.token,
          label: body.data.label,
          at: new Date().toISOString(),
        })
      : withoutDevice(devices, body.data.token),
  });
  return NextResponse.json(
    saved === 'saved' ? { ok: true } : { ok: false, code: 'UNAVAILABLE' },
    { headers: NO_STORE },
  );
}

export const POST = (request: Request): Promise<Response> => change(request, true);
export const DELETE = (request: Request): Promise<Response> => change(request, false);

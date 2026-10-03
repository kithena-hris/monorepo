import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { tenantOfToken } from '../../../../../lib/kiosk';

/**
 * A kiosk's three requests (TOF-108), on the company's own origin, passed to
 * Time Off's device routes with the kiosk's own token: its name (`status`),
 * who tapped (`identify`) and its queue of taps (`punches`).
 *
 * Same-origin so the kiosk's service worker can hold `punches` while the
 * network is down (`public/kiosk-sw.js`). Nothing here authenticates
 * anybody: Time Off checks the token. What this does check is that the
 * token names the company whose address the tablet is on — the tenant comes
 * from the proxy, never from the request — and that only these three paths
 * are reachable.
 *
 * `TIMEOFF_PUBLIC_URL` is where Time Off's public routes are, as for the
 * calendar feed; outside development the tunnel must route `/v1/timeoff/kiosk/*`.
 */

const ACTIONS = { status: 'GET', identify: 'POST', punches: 'POST' } as const;
type Action = keyof typeof ACTIONS;

async function forward(
  request: Request,
  params: Promise<{ deviceId: string; action: string }>,
): Promise<Response> {
  const { deviceId, action } = await params;
  if (!(action in ACTIONS) || ACTIONS[action as Action] !== request.method) {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const tenantId = (await headers()).get('x-tenant-id');
  if (tenantId === null || tenantOfToken(token) !== tenantId) {
    return NextResponse.json(
      { error: { code: 'INVALID_TOKEN', message: 'This kiosk is not registered here' } },
      { status: 401 },
    );
  }
  const origin = (process.env['TIMEOFF_PUBLIC_URL'] ?? 'http://localhost:4002').replace(/\/$/u, '');
  const path = action === 'status' ? '' : `/${action}`;
  const answer = await fetch(`${origin}/v1/timeoff/kiosk/${encodeURIComponent(deviceId)}${path}`, {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(request.method === 'POST' ? { body: await request.text() } : {}),
    cache: 'no-store',
  }).catch(() => null);
  if (answer === null) {
    return NextResponse.json(
      { error: { code: 'UNREACHABLE', message: 'Time Off could not be reached' } },
      { status: 503 },
    );
  }
  return new NextResponse(await answer.text(), {
    status: answer.status,
    headers: { 'content-type': 'application/json' },
  });
}

export function GET(
  request: Request,
  { params }: { params: Promise<{ deviceId: string; action: string }> },
): Promise<Response> {
  return forward(request, params);
}

export function POST(
  request: Request,
  { params }: { params: Promise<{ deviceId: string; action: string }> },
): Promise<Response> {
  return forward(request, params);
}

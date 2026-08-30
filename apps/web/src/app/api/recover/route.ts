import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Asking for a fresh setup link, on the company's own origin.
 *
 * A thin pass-through: identity requires the internal token and a browser must
 * never hold one. **The tenant comes from the proxy, never from the body** —
 * `proxy.ts` resolves it from the hostname and deletes any inbound copy first,
 * so nobody can ask for a link at a company they are not visiting.
 *
 * Answers 202 to everything identity answers 202 to, which is everything. An
 * unknown address and a real one are the same response; see the route in
 * `enrolment-routes.ts` for why.
 */
export async function POST(request: Request): Promise<Response> {
  const tenantId = (await headers()).get('x-tenant-id');
  if (tenantId === null || tenantId === '') {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const workEmail = typeof Reflect.get(body ?? {}, 'workEmail') === 'string'
    ? (Reflect.get(body ?? {}, 'workEmail') as string)
    : '';
  if (workEmail.trim() === '') {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const asked = await fetch(
    `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/enrolment/recover`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      body: JSON.stringify({ tenantId, workEmail }),
      cache: 'no-store',
    },
  ).catch(() => null);

  if (!asked?.ok) return NextResponse.json({ ok: false }, { status: 502 });
  return NextResponse.json({ ok: true }, { status: 202 });
}

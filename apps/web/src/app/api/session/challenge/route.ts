import { NextResponse } from 'next/server';

/**
 * The options a passkey prompt needs, fetched on this origin's behalf.
 *
 * A thin pass-through, and it exists for one reason: identity requires the
 * internal token and a browser must never hold one.
 *
 * POST even though it reads like a read. Beginning an authentication allocates
 * a challenge that identity records and expires, so it changes server state,
 * and a GET is a request a browser may repeat, prefetch or serve from cache —
 * all three of which hand out challenges nobody asked for.
 */
export async function POST(): Promise<Response> {
  const begun = await fetch(
    `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/webauthn/authenticate/begin`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      body: '{}',
      cache: 'no-store',
    },
  ).catch(() => null);

  if (!begun?.ok) return NextResponse.json({ ok: false }, { status: 502 });

  const body = (await begun.json()) as { options?: unknown };
  if (body.options === undefined) return NextResponse.json({ ok: false }, { status: 502 });

  return NextResponse.json({ options: body.options }, { headers: { 'cache-control': 'no-store' } });
}

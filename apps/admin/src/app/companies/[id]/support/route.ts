import { cookies } from 'next/headers';

import { callIdentity } from '../../../../lib/identity';
import { SESSION_COOKIE } from '../../../../lib/session';
import { tenantUrl } from '../../../../lib/tenant-host';

/**
 * "Sign in as support": the form on the company page posts here in a new tab,
 * and the tab ends up on the company's own app, signed in as its support agent.
 *
 * A route handler rather than a server action, because the new tab has to be
 * opened by the operator's click to get past a popup blocker — a form with
 * `target="_blank"` is exactly that — and a server action would run in this tab
 * instead.
 *
 * Identity is sent the operator's session id, not an operator id: it checks the
 * session itself and acts as whoever it belongs to. This handler holds no
 * authority of its own beyond the cookie the browser sent.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const back = (outcome: string): Response => seeOther(`/companies/${id}?support=${outcome}`);

  /*
   * Same origin only. The cookie is `SameSite=Lax`, so a cross-site form post
   * arrives without it anyway; this says so explicitly rather than relying on
   * the browser's default.
   */
  const origin = request.headers.get('origin');
  if (
    origin === null ||
    !URL.canParse(origin) ||
    new URL(origin).host !== request.headers.get('host')
  ) {
    return new Response(null, { status: 403 });
  }

  const operatorSessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (operatorSessionId === undefined || operatorSessionId === '') return seeOther('/sign-in');

  const reason = (await request.formData()).get('reason');

  const [company, started] = await Promise.all([
    callIdentity(`/api/internal/admin/tenants/${id}`),
    callIdentity('/api/internal/support/start', {
      method: 'POST',
      body: { operatorSessionId, tenantId: id, reason: typeof reason === 'string' ? reason : '' },
    }),
  ]);

  if (started.status === 401) return seeOther('/sign-in');
  if (started.status === 400) return back('reason');

  const slug = (company.body as { slug?: unknown } | null)?.slug;
  const code = (started.body as { code?: unknown } | null)?.code;
  if (started.status !== 201 || typeof code !== 'string' || typeof slug !== 'string') {
    return back('failed');
  }

  return seeOther(tenantUrl(slug, `/auth/callback?code=${encodeURIComponent(code)}`));
}

/**
 * 303, so the tab follows with a GET, and no referrer: the company's app has no
 * business learning the back office's address.
 */
function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' },
  });
}

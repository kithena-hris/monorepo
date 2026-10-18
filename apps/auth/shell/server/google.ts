import type { MiddlewareHandler } from '@modern-js/server-runtime';

/**
 * Signing in with Google: the two addresses Google's trip passes through.
 *
 * `/google/start?tenant=acme` comes from the company's own sign-in page and is
 * sent on to Google; `/google/callback` is the one redirect URI registered
 * with Google, which allows no wildcards (`docs/authentication.md`, "Why
 * Google forces a central callback"). Identity does the work — the trip, the
 * code exchange, the account — and answers with a 60-second handoff code;
 * this only moves the browser, and never holds a session.
 *
 * The company's address is the sibling of this one (`auth.app.kithena.com`
 * beside `acme.app.kithena.com`), as `chat-return.ts` works it out, unless
 * `MODERN_TENANT_APP_BASE` names it, as it does locally where the ports differ.
 */
const IDENTITY = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4100';
const TOKEN = process.env['INTERNAL_API_TOKEN'] ?? '';

const SLUG = /^[a-z0-9-]{1,63}$/;

/** A company's own origin, from its label and this origin's address. */
export function tenantOrigin(
  slug: string,
  auth: URL,
  base = process.env['MODERN_TENANT_APP_BASE'] ?? '',
): string | null {
  if (!SLUG.test(slug)) return null;
  if (base !== '') return base.replace('{slug}', slug).replace(/\/$/u, '');
  const [own, ...rest] = auth.hostname.split('.');
  if (rest.length < 2 || own === slug) return null;
  return `${auth.protocol}//${slug}.${rest.join('.')}${auth.port === '' ? '' : `:${auth.port}`}`;
}

/** Where identity's answer sends the browser. */
export function landing(
  answer: { tenantSlug?: unknown; code?: unknown; app?: unknown },
  auth: URL,
  base?: string,
): string {
  const slug = typeof answer.tenantSlug === 'string' ? answer.tenantSlug : '';
  const origin = tenantOrigin(slug, auth, base);
  // Not even the company is known: the signpost that asks which.
  if (origin === null) return new URL('/login', auth).toString();

  if (typeof answer.code !== 'string' || answer.code === '') {
    return `${origin}/login?error=google`;
  }
  const to = new URL(`${origin}/auth/callback`);
  to.searchParams.set('code', answer.code);
  const app = answer.app as { redirect?: unknown; challenge?: unknown } | null | undefined;
  if (typeof app?.redirect === 'string' && typeof app.challenge === 'string') {
    to.searchParams.set('app', app.redirect);
    to.searchParams.set('challenge', app.challenge);
  }
  return to.toString();
}

async function identity(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(new URL(path, IDENTITY), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('[google] unreachable', { host: new URL(IDENTITY).host, error });
    return null;
  }
}

export const googleSignIn: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  if (path !== '/google/start' && path !== '/google/callback') return next();
  if (c.req.method !== 'GET') return c.text('Use GET.', 405);

  const url = new URL(c.req.url);
  const host = c.req.header('x-forwarded-host');
  const auth = host === undefined ? url : new URL(`${url.protocol}//${host}`);
  const query = (key: string): string => url.searchParams.get(key) ?? '';

  if (path === '/google/start') {
    const slug = query('tenant');
    const app =
      query('app') !== '' && query('challenge') !== ''
        ? { redirect: query('app'), challenge: query('challenge') }
        : null;
    const begun = await identity('/api/internal/google/begin', { tenantSlug: slug, app });
    const sent = begun?.ok === true ? ((await begun.json()) as { url?: unknown }).url : null;
    if (typeof sent === 'string') return c.redirect(sent, 302);
    return c.redirect(landing({ tenantSlug: slug }, auth), 302);
  }

  // Google's own refusal (`?error=access_denied`) still spends the trip, so
  // identity can say which company to send the person back to.
  const finished = await identity('/api/internal/google/finish', {
    code: query('error') === '' ? query('code') : '',
    state: query('state'),
    device: { userAgent: c.req.header('user-agent') ?? '' },
  });
  const answer = finished === null ? {} : ((await finished.json().catch(() => ({}))) as object);
  c.header('cache-control', 'no-store');
  return c.redirect(landing(answer, auth), 302);
};

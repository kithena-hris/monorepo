import 'server-only';
import { headers } from 'next/headers';

/**
 * What this company may be shown as, on its own origin.
 *
 * `proxy.ts` resolves the tenant on every request and forwards its id and slug,
 * and deliberately forwards nothing else — it is the one file that decides what
 * a request may claim about which company it belongs to, and each extra header
 * there is another thing to sanitise on the file where a mistake is one tenant
 * reading another's data.
 *
 * So the branding is read here instead, by id, against the same registry route
 * the proxy uses. It costs a request on a cache miss and nothing on a hit,
 * because the answer is identical for every visitor to this hostname.
 */
export interface Branding {
  readonly displayName: string | null;
  readonly logoUrl: string | null;
  readonly coverImageUrl: string | null;
  readonly themeId: string | null;
}

export interface TenantContext {
  readonly id: string;
  readonly slug: string;
  readonly branding: Branding;
}

const NOTHING: Branding = {
  displayName: null,
  logoUrl: null,
  coverImageUrl: null,
  themeId: null,
};

/**
 * The company this request is for, with whatever it has agreed to be shown as.
 *
 * Never throws and never returns half a company: a registry that cannot be
 * reached yields the slug with no branding, which renders as an unbranded page
 * rather than an error. The alternative is a sign-in screen that fails because
 * a logo could not be fetched.
 */
export async function currentTenant(): Promise<TenantContext | null> {
  const inbound = await headers();
  const id = inbound.get('x-tenant-id');
  const slug = inbound.get('x-tenant-slug');
  if (id === null || id === '' || slug === null || slug === '') return null;

  try {
    const response = await fetch(
      `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/tenant/${encodeURIComponent(slug)}`,
      {
        headers: { 'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '' },
        // Branding changes when an operator edits it, and the next visitor
        // should see the change. This is one request per render against a
        // service on the same network, not a query.
        cache: 'no-store',
      },
    );
    if (!response.ok) return { id, slug, branding: NOTHING };

    const body: unknown = await response.json();
    const branding =
      body !== null &&
      typeof body === 'object' &&
      'branding' in body &&
      body.branding !== null &&
      typeof body.branding === 'object'
        ? (body.branding as Record<string, unknown>)
        : {};

    const text = (key: string): string | null =>
      typeof branding[key] === 'string' ? branding[key] : null;

    return {
      id,
      slug,
      branding: {
        displayName: text('displayName'),
        logoUrl: text('logoUrl'),
        coverImageUrl: text('coverImageUrl'),
        themeId: text('themeId'),
      },
    };
  } catch {
    return { id, slug, branding: NOTHING };
  }
}

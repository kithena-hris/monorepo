/**
 * Turning a company's name into the tenant behind it.
 *
 * `acme` rather than `95bfa139-0282-…`, because a person types the first and
 * nobody types the second. The label is the same one that will be the hostname
 * in production — `acme.app.kithena.com` — so a link that carries it is a link
 * that survives the move.
 *
 * **This lookup is a local shim.** In production nothing resolves a slug here:
 * the request arrives at the tenant's own hostname, the proxy in front of the
 * app resolves it once, and the page is already scoped by the time it renders.
 * On one shared `localhost` origin there is no hostname to read, so the page
 * asks. That is the only reason this file exists, and it goes away with the
 * tenant subdomains.
 *
 * The registry itself does the work, so the rules hold either way: a reserved
 * label, a punycode homograph, a suspended customer and a name nobody
 * registered all resolve to nothing, and nothing is a refusal.
 */
export interface Tenant {
  readonly id: string;
  readonly slug: string;
}

export async function resolveTenant(slug: string): Promise<Tenant | null> {
  if (slug === '') return null;

  const response = await fetch(
    `/api/identity/tenant/${encodeURIComponent(slug)}`,
    // The registry answers per company and changes when one signs up. Caching
    // it in the browser would keep a suspended customer reachable.
    { headers: { 'cache-control': 'no-store' } },
  );
  if (!response.ok) return null;

  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object') return null;

  const { id, slug: found } = body as Record<string, unknown>;
  return typeof id === 'string' && typeof found === 'string' ? { id, slug: found } : null;
}

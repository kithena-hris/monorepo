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
  /**
   * Null throughout when the company has asked not to be named.
   *
   * The decision is the registry's, not this page's — see `brandingFor` in the
   * identity service. A screen that had to remember to check a flag is a screen
   * that leaks the customer list the first time somebody adds a heading.
   */
  readonly branding: {
    readonly displayName: string | null;
    readonly logoUrl: string | null;
    /** Fills the left half of the sign-in page. */
    readonly coverImageUrl: string | null;
    /**
     * The preset id, which becomes the whole brand ramp.
     *
     * Present even when the company has asked not to be named: an accent
     * identifies nobody — six presets across every customer — and withholding
     * it would drop their own staff back to the default colour for no privacy
     * gained. See `brandingFor` in the identity service.
     */
    readonly themeId: string | null;
    /** @deprecated Superseded by `themeId`. */
    readonly accentColor: string | null;
  };
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

  const { id, slug: found, branding } = body as Record<string, unknown>;
  if (typeof id !== 'string' || typeof found !== 'string') return null;

  const b =
    branding !== null && typeof branding === 'object' ? (branding as Record<string, unknown>) : {};
  return {
    id,
    slug: found,
    branding: {
      displayName: typeof b['displayName'] === 'string' ? b['displayName'] : null,
      logoUrl: typeof b['logoUrl'] === 'string' ? b['logoUrl'] : null,
      coverImageUrl: typeof b['coverImageUrl'] === 'string' ? b['coverImageUrl'] : null,
      themeId: typeof b['themeId'] === 'string' ? b['themeId'] : null,
      accentColor: typeof b['accentColor'] === 'string' ? b['accentColor'] : null,
    },
  };
}

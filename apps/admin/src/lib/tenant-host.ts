/**
 * Where a company's own app lives.
 *
 * The back-office shows this on four screens and every one of them had
 * `.app.kithena.com` typed into it. On staging that produced
 * `acme.app.kithena.com` — a real hostname, belonging to production, that
 * happened to be wrong. An operator following it from a staging screen either
 * lands nowhere or, worse, lands on the customer's live site while testing.
 *
 * `TENANT_HOST_SUFFIX` is the same variable `apps/web/src/proxy.ts` strips to
 * find the tenant, so the two cannot disagree about what a company's address
 * is. The workflows set it per environment.
 *
 * Not `NEXT_PUBLIC_`: every caller is a server component, and a value inlined
 * into the browser bundle would be one more thing to get wrong at build time
 * for no benefit.
 */
const SUFFIX = process.env['TENANT_HOST_SUFFIX'] ?? 'app.localhost:3000';

/**
 * The suffix itself, for a client component that has to build its own.
 *
 * Handed down as a prop rather than read there: `process.env` is a server value
 * and would silently be `undefined` in the browser.
 */
export function tenantHostSuffix(): string {
  return SUFFIX;
}

/** `acme.staging.app.kithena.com`. The bare hostname, for display. */
export function tenantHost(slug: string): string {
  return `${slug}.${SUFFIX}`;
}

/**
 * `https://acme.staging.app.kithena.com`, for a link somebody will follow.
 *
 * Two adjustments for local development, and both exist because a copy button
 * that hands over a URL which does not work is worse than no copy button.
 *
 * `http`, because that is what `next dev` serves — a link to `https://…localhost`
 * fails in a way that looks like the app is broken rather than like a scheme
 * mismatch.
 *
 * And the port, because `TENANT_HOST_SUFFIX` is the string `proxy.ts` strips
 * from a `Host` header to find the tenant label, so it deliberately carries no
 * port. Displaying it is right; linking to it is not.
 */
const LOCAL_TENANT_PORT = '3000';

export function tenantUrl(slug: string, path = ''): string {
  const local = SUFFIX.includes('localhost');
  const scheme = local ? 'http' : 'https';
  const port = local && !SUFFIX.includes(':') ? `:${LOCAL_TENANT_PORT}` : '';
  return `${scheme}://${tenantHost(slug)}${port}${path}`;
}

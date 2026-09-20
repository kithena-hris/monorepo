/**
 * No `server-only`, deliberately, and it is the same call `tenant.ts` makes.
 *
 * That guard exists to keep a credential out of the browser bundle, and there
 * is none here: this takes headers in and returns a string. What it buys
 * instead is a test — `server-only` throws outside a Next bundler, so a module
 * carrying it cannot be exercised by vitest, and this is a security-path
 * function whose bug was invisible until somebody called it.
 */
/**
 * The origin a WebAuthn ceremony happened on.
 *
 * **Not `new URL(request.url).origin`**, which is what every one of these
 * routes used and what broke passkey sign-in on a company's own hostname.
 * Next rebuilds `request.url` for a route handler from the address the server
 * is bound to, not from the request's `Host` — so a ceremony performed at
 * `acme.app.localhost:3000` arrived at identity as `http://localhost:3000`.
 * The tenant label was gone, the origin no longer ended in the relying-party
 * id, and identity correctly refused every assertion. It logged `origin` and
 * nothing else, which is why it read as "the passkey does not work".
 *
 * The `Host` header is caller-controlled, and using it here is safe for one
 * specific reason: `proxy.ts` has already resolved the tenant from this exact
 * header and returned 404 if it did not name one. So any request that reaches a
 * route handler carries a host whose label is a company we issued. Identity
 * then checks the origin against the RP suffix a second time. Two independent
 * checks, neither trusting the body.
 *
 * `x-forwarded-proto` first, because the scheme in front of a proxy is the
 * proxy's, not this process's — behind Vercel the connection here is plain
 * HTTP and the browser's was HTTPS, and an origin claiming `http` would not
 * match the one the authenticator signed over.
 */
export function ceremonyOrigin(inbound: Headers): string | null {
  const host = inbound.get('host');
  if (host === null || host === '') return null;

  const forwarded = inbound.get('x-forwarded-proto');
  // A comma-separated list when more than one proxy has added to it. The first
  // entry is the one the browser spoke to.
  const scheme = (forwarded?.split(',')[0]?.trim() ?? '') === 'https' ? 'https' : 'http';

  return `${scheme}://${host}`;
}

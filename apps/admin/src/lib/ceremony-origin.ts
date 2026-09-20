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
 * **Not `new URL(request.url).origin`**, which is what these routes used. Next
 * rebuilds `request.url` for a route handler from the address the server is
 * bound to rather than from the request's `Host`, so the value is only correct
 * while those two agree. They do agree for the back-office, which is one app on
 * one hostname — but they did not for the tenant app, where a ceremony at
 * `acme.app.localhost:3000` reached identity as `http://localhost:3000` and
 * every assertion was refused. Same mistake, and here it happens to be
 * harmless; that is not a reason to keep it.
 *
 * `x-forwarded-proto` first, because the scheme in front of a proxy is the
 * proxy's, not this process's — behind Vercel the connection here is plain HTTP
 * and the browser's was HTTPS, and an origin claiming `http` would not match
 * the one the authenticator signed over.
 *
 * Identity checks this against the origin it was configured with, so a caller
 * inventing a `Host` gets a refusal rather than a session.
 */
export function ceremonyOrigin(request: Request): string | null {
  const host = request.headers.get('host');
  if (host === null || host === '') return null;

  const forwarded = request.headers.get('x-forwarded-proto');
  // A comma-separated list when more than one proxy has added to it. The first
  // entry is the one the browser spoke to.
  const scheme = (forwarded?.split(',')[0]?.trim() ?? '') === 'https' ? 'https' : 'http';

  return `${scheme}://${host}`;
}

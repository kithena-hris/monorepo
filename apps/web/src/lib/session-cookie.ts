/**
 * The session cookie's name, on its own.
 *
 * Split out of `session.ts` because that module is `server-only` and the proxy
 * is not: middleware runs in its own runtime, and importing the server module
 * there is a build error. The name is needed in both — the proxy asks whether
 * the cookie exists, the server asks whether it means anything — and one
 * constant is what keeps those two from drifting into a bug where a rename
 * silently stops the redirect from ever firing.
 *
 * `__Host-` is not decoration. A browser refuses the prefix unless the cookie is
 * `Secure`, carries no `Domain` and is pathed at `/` — which is what stops a
 * sibling subdomain setting it, and is the property `docs/authentication.md`
 * leans on. See `lib/session.ts`.
 */
export const SESSION_COOKIE = '__Host-ksession';

/**
 * While a People administrator views the app as somebody, their own session,
 * put aside: `__Host-ksession` is then the view-as session, and this is what
 * ending it — or its thirty minutes running out — puts back. Its value is
 * `<own session>.<person viewed>.<own session's end, epoch ms>`
 * (`returnCookie`, `lib/view-as.ts`). Absent the rest of the time.
 */
export const RETURN_COOKIE = '__Host-kreturn';

import { SESSION_COOKIE } from './session-cookie';

/**
 * A return from another site (a tool a person linked, a chat app the company
 * added) that arrived without the session cookie.
 *
 * Signing in with a passkey sets the cookie `SameSite=Strict`
 * (`app/api/session/route.ts`), and a browser does not send a Strict cookie on
 * a navigation that began on github.com or slack.com, even though it lands
 * here. So the first arrival looks signed out. It is answered with a page that
 * loads the same address again: that navigation begins on this site, so the
 * cookie goes with it. A second arrival without the cookie really is signed out,
 * and goes to sign in.
 *
 * A meta refresh, not a script: nothing for the content security policy to
 * refuse, and no code on a page whose address carries a one-time code.
 * Null when the cookie came, and the return can be finished.
 */
export function strictReturn(request: Request): Response | null {
  const cookies = request.headers.get('cookie') ?? '';
  if (cookies.split(';').some((c) => c.trim().startsWith(`${SESSION_COOKIE}=`))) return null;
  const url = new URL(request.url);
  if (url.searchParams.has('again')) return Response.redirect(new URL('/login', url), 303);
  url.searchParams.set('again', '1');
  return loadAgain(url);
}

/**
 * Any page opened from another site without the session cookie: an email's
 * button pressed in a webmail, a link in a chat. The Strict cookie stayed
 * behind, so the page is loaded again from here and it goes with it; a person
 * signed in in another tab lands on the page, not on sign-in. That second
 * load begins on this site (`sec-fetch-site: same-origin`), so somebody really
 * signed out then goes to sign in, and nothing loops. Null for anything else.
 */
export function fromAnotherSite(request: Request): Response | null {
  if (request.method !== 'GET') return null;
  if (request.headers.get('sec-fetch-mode') !== 'navigate') return null;
  if (request.headers.get('sec-fetch-site') !== 'cross-site') return null;
  return loadAgain(new URL(request.url));
}

/** The same address, loaded again by a page from this site. */
function loadAgain(url: URL): Response {
  const to = `${url.pathname}${url.search}`.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${to}"><title>Kithena</title>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    },
  );
}

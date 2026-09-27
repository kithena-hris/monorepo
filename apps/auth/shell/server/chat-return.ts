import type { MiddlewareHandler } from '@modern-js/server-runtime';

/**
 * Where a chat app (Slack today) sends somebody back after connecting it.
 *
 * A chat app accepts a fixed list of return addresses and a company's is its
 * own subdomain, so every company returns here, to `/chat/<app>/done`, and is
 * passed on to its own `/people/chat/<app>/done`, where it is finished as the
 * administrator who started it. Nothing is exchanged here and nothing is
 * kept: this reads which company from the `state` the app hands back, and the
 * app's service checks that state's signature when the company completes it.
 *
 * Passed on only to a company origin — one label beneath the domain this
 * origin sits under (`acme.app.kithena.com` beside `auth.app.kithena.com`) —
 * so the one open parameter cannot send anybody anywhere else.
 */
const RETURN_PATH = /^\/chat\/([a-z]{1,20})\/done$/;

export function chatReturnTo(url: URL, authHost: string): string | null {
  const app = RETURN_PATH.exec(url.pathname)?.[1];
  if (app === undefined) return null;
  const state = url.searchParams.get('state') ?? '';
  const [claims] = state.split('.');
  let origin: URL;
  try {
    const parsed = JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8')) as {
      o?: unknown;
    };
    if (typeof parsed.o !== 'string') return null;
    origin = new URL(parsed.o);
  } catch {
    return null;
  }
  const parent = authHost.split('.').slice(1).join('.');
  const [label, ...rest] = origin.hostname.split('.');
  if (
    parent === '' ||
    rest.join('.') !== parent ||
    !/^[a-z0-9-]{1,63}$/.test(label ?? '') ||
    label === authHost.split('.')[0] ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' && origin.protocol !== 'http:')
  ) {
    return null;
  }
  const to = new URL(`/people/chat/${app}/done`, origin);
  for (const key of ['code', 'state', 'error']) {
    const value = url.searchParams.get(key);
    if (value !== null) to.searchParams.set(key, value);
  }
  return to.toString();
}

export const chatReturn: MiddlewareHandler = async (c, next) => {
  if (!RETURN_PATH.test(c.req.path)) return next();
  const url = new URL(c.req.url);
  const to = chatReturnTo(url, url.hostname);
  if (to === null) return c.text('This link is not one Kithena made.', 400);
  return c.redirect(to, 302);
};

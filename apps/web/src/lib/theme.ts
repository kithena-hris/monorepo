/**
 * Where a person's light-or-dark choice is remembered: a cookie, so the server
 * renders `<html class="dark">` itself and the first paint is already right
 * (`app/layout.tsx` says why a class set only by a script does not stay).
 *
 * A plain module, and that matters: the root layout needs this string on the
 * server and the toggle needs it in the browser. A constant exported from a
 * `'use client'` module is not a string on the server — it is a client
 * reference — and interpolating one into the script matches nothing, which
 * reads as "nothing chosen" forever.
 *
 * Per origin, so it is already per company: `acme.app.kithena.com` and
 * `globex.app.kithena.com` have separate cookies, and somebody who works at
 * both can prefer differently at each without this knowing anything about
 * tenants.
 */
export const THEME_KEY = 'kithena-theme';

/** Remembers a choice for a year, like any preference; `Lax`, because it only shapes the page. */
export function themeCookie(dark: boolean): string {
  return `${THEME_KEY}=${dark ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
}

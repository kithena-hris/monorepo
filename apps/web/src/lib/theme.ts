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

/**
 * The window's own colour in each theme: Reach's canvas, as sRGB (a browser's
 * title bar does not resolve `oklch()` everywhere), so an installed app's
 * title bar and a phone's status bar are the page's colour, not white over a
 * dark page. Copied from `--reach-color-canvas`, as `palette.ts` copies it.
 */
export const THEME_COLOR = { light: '#f5f6f8', dark: '#000000' } as const;

/** The title bar follows a choice made on the page, without waiting for a reload. */
export function paintThemeColor(dark: boolean): void {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
    meta.removeAttribute('media');
  }
}

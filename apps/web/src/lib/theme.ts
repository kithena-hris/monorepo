/**
 * Where a person's light-or-dark choice is remembered.
 *
 * A plain module, and that matters: the root layout needs this string to build
 * its inline script and the toggle needs it to write the value. A constant
 * exported from a `'use client'` module is not a string on the server — it is a
 * client reference — and interpolating one into the script produces
 * `localStorage.getItem(undefined)`, which reads as "nothing stored" forever.
 *
 * Per origin, so it is already per company: `acme.app.kithena.com` and
 * `globex.app.kithena.com` have separate storage, and somebody who works at
 * both can prefer differently at each without this knowing anything about
 * tenants.
 */
export const THEME_KEY = 'kithena-theme';

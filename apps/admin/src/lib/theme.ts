/**
 * Where the chosen theme is remembered.
 *
 * A plain module, and that is the point: the root layout needs this string to
 * build its inline script and the toggle needs it to write the value, and a
 * constant exported from a `'use client'` module is not a string on the server
 * — it is a client reference. Interpolating one into the script produced
 * `localStorage.getItem(undefined)`, which reads as "nothing stored" forever,
 * so every reload fell back to the system preference and a chosen theme never
 * survived the page.
 */
export const THEME_KEY = 'kithena-admin-theme';

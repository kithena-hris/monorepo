/**
 * Where a person's collapsed-or-expanded sidebar is remembered: a cookie, so
 * the server renders the rail or the full sidebar and the first paint is
 * already right. Per device, like the choice itself.
 *
 * A plain module for the same reason as `theme.ts`: the shell writes the
 * cookie in the browser and every page reads it on the server, and a constant
 * exported from a `'use client'` module is not a string on the server.
 */
export const SIDEBAR_COOKIE = 'kithena-sidebar';

/** The remembered state; `undefined` when nothing is, and the layout's width decides. */
export function sidebarCollapsedFrom(value: string | undefined): boolean | undefined {
  return value === 'collapsed' ? true : value === 'expanded' ? false : undefined;
}

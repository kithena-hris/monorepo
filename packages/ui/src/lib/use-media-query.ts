'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a media query.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`: the effect
 * version renders once with the wrong answer, and in a streamed or hydrated
 * page that wrong first frame is what the user sees flash.
 *
 * The server snapshot is `false` for the same reason, a server has no
 * viewport, so it renders the layout that works everywhere and lets the client
 * narrow it. This is why the CSS breakpoints are the primary mechanism and
 * this hook is the exception: CSS resolves before the first paint and JS
 * cannot.
 *
 * Reach for it only when the *structure* has to change (a table becoming a
 * card list, a modal becoming a bottom sheet), never for styling.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Breakpoints as strings, matching the `--breakpoint-*` theme values exactly.
 * Duplicating a number here that CSS also holds is how a layout ends up
 * switching at 768px in CSS and 767px in JS.
 */
export const breakpointQuery = {
  xs: '(min-width: 26rem)',
  sm: '(min-width: 40rem)',
  md: '(min-width: 48rem)',
  lg: '(min-width: 64rem)',
  xl: '(min-width: 80rem)',
  '2xl': '(min-width: 96rem)',
  '3xl': '(min-width: 120rem)',
} as const;

export type Breakpoint = keyof typeof breakpointQuery;

/** True at or above the named breakpoint. */
export function useBreakpoint(name: Breakpoint): boolean {
  return useMediaQuery(breakpointQuery[name]);
}

/** True when the primary pointer cannot hover, a finger, not a mouse. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/**
 * True when the OS asks for reduced motion. Components should not need this,
 * the base layer already collapses every duration, but an animation driven
 * from JS (a count-up, a scroll tween) has no stylesheet to collapse.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

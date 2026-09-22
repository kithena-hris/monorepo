import type { JSX, ReactNode } from 'react';

/**
 * The entrance every screen in this app gets, and the only motion a navigation
 * has.
 *
 * ### Why a template and not a layout
 *
 * `template.tsx` is given a fresh key on every navigation, so its children
 * remount and a CSS animation on this element replays. A `layout.tsx` persists
 * across routes and would play the entrance exactly once, on the first load of
 * the session — which is the version of this that looks broken rather than
 * absent, because the first page animates and none of the others do.
 *
 * ### Why CSS and not a motion library
 *
 * The animation is predetermined: the same eight pixels and the same fade
 * every time, with nothing to interrupt and no gesture driving it. A CSS
 * animation runs off the main thread, so it stays smooth through the
 * hydration and data fetching that a navigation is otherwise busy with —
 * which is the exact moment a `requestAnimationFrame` loop drops frames.
 *
 * ### Why it is this small
 *
 * `--animate-enter` is 200ms and half a rem. Somebody works in an HRIS all
 * day; a page transition they wait for is a page transition they come to
 * resent, and the useful thing here is only that the screen reads as *placed*
 * rather than as having blinked. The delight budget belongs on the rare
 * screens — enrolment, a first sign-in — not on the twentieth navigation
 * before lunch.
 *
 * `motion-safe:` because a whole-page movement is the vestibular case
 * `prefers-reduced-motion` is written for. The setting still gets the colour
 * and opacity transitions `base.css` keeps; it does not get the travel.
 */
export default function Template({ children }: { children: ReactNode }): JSX.Element {
  return <div className="motion-safe:animate-enter">{children}</div>;
}

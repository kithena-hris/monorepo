/**
 * Reach's motion, as numbers: one module both libraries read.
 *
 * The web reaches these as CSS custom properties in `theme.css`
 * (`--animate-duration-*`, `--ease-*`, the flyout keyframes); the phone reads
 * this file directly (`@reach/ui/motion`) and hands the values to Reanimated.
 * `motion.test.ts` fails when the stylesheet and this file disagree, so the
 * two libraries cannot drift apart.
 *
 * Pure on purpose: no DOM, no React, no import beyond `spring.ts`. That is
 * what lets `@reach/ui-native` import it, and the dependency-cruiser rule that
 * keeps the rest of `packages/ui` out of the native library lets these two
 * files through (and the equally pure filter model, nothing else).
 */
import { springs, type SpringConfig } from './spring';

export { springs, type SpringConfig };

/**
 * How long a pointer rests before something opens on hover, and how long it
 * may leave before it closes: the sidebar flyout's timings, shared by every
 * hover-opened surface so they all answer a pointer at the same speed.
 *
 * Opening waits a moment so a pointer crossing the item on its way somewhere
 * else opens nothing; closing waits a little longer so the gap between the
 * trigger and the surface can be crossed.
 */
export const HOVER_OPEN_MS = 50;
export const HOVER_CLOSE_MS = 80;

/**
 * Durations, in milliseconds. `instant` reads as a state change, `fast` as a
 * response, `normal` as a movement and `slow` as something travelling a
 * distance. Anything longer reads as a delay. Exits use `fast`: leaving is
 * quicker than arriving.
 */
export const durations = {
  instant: 80,
  fast: 140,
  normal: 200,
  slow: 320,
} as const;

/** Cubic-bézier control points: `standard` for change in place, `entrance` arriving, `exit` leaving. */
export const easings = {
  standard: [0.2, 0, 0, 1],
  entrance: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** A pressed control shrinks to this, and springs back on release. */
export const PRESS_SCALE = 0.97;

/**
 * Everything that pops over the page: out of the side it opens from, `travel`
 * px with a fade and a hair of scale, in at `normal` and out at `fast`, going
 * back three quarters of the way. The sidebar flyout's motion, which the menu,
 * the popover, a select's list and the hover card all share.
 */
export const flyout = {
  travel: 8,
  scaleIn: 0.985,
  scaleOut: 0.99,
  exitTravel: 0.75,
} as const;

/**
 * A centred modal, a dialog or an alert: a fade and a scale up from `scale`,
 * in at `fast` with the entrance curve and out at `fast` with the exit. It
 * does not travel: it was not opened from anywhere.
 */
export const modal = { scale: 0.96 } as const;

/**
 * A staggered group: each neighbour `step` ms after the last, never more than
 * `max` in all. 30 is the smallest step that reads as a sequence rather than
 * one event; the ceiling keeps the fortieth card from looking broken.
 */
export const stagger = { step: 30, max: 180 } as const;

/** Fade and rise: content arriving, half a rem below where it lands. */
export const RISE = 8;

/**
 * The one gentle spring, for things a finger can throw: a sheet, a card
 * landing in a column. Slightly under-damped, because the overshoot is the
 * momentum the finger put in. It is the web's `drawer` spring.
 */
export const gentleSpring: SpringConfig = springs.drawer;

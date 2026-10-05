/**
 * Reach's motion presets for the phone, built from the numbers the web uses.
 *
 * Every value comes from `@reach/ui/motion`, the module both libraries read;
 * nothing here is a duration, an easing or a distance of its own. This file
 * only decides how those numbers become a press, an overlay, a sheet, an
 * entrance and a layout change, and what each becomes under reduced motion.
 *
 * Pure data, so it is tested without a device; `animate.ts` hands it to
 * Reanimated.
 */
import {
  durations,
  easings,
  flyout,
  gentleSpring,
  PRESS_SCALE,
  RISE,
  springs,
  type SpringConfig,
} from '@reach/ui/motion';

export { durations, easings, gentleSpring, PRESS_SCALE, springs };

export type Bezier = readonly [number, number, number, number];
export type Timing = { type: 'timing'; duration: number; easing: Bezier };
/** Reanimated's physical spring: mass, stiffness, damping. */
export type Spring = { type: 'spring'; mass: number; stiffness: number; damping: number };
export type Transition = Timing | Spring;

/** Where a view is drawn at one end of a motion. */
export type Pose = { opacity: number; translateX: number; translateY: number; scale: number };
export type Motion = { from: Pose; to: Pose; transition: Transition };

/** The side an overlay opens on, as Radix names it. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

const timing = (duration: number, easing: Bezier): Timing => ({ type: 'timing', duration, easing });

/**
 * A spring in Apple's damping/response form (`spring.ts`) as Reanimated's
 * physical one: mass folded to 1, stiffness ω², damping 2ζω, the same
 * conversion `stepSpring` uses on the web.
 */
export function physics({ damping, response }: SpringConfig): Spring {
  const omega = (2 * Math.PI) / response;
  return { type: 'spring', mass: 1, stiffness: omega * omega, damping: 2 * damping * omega };
}

const REST: Pose = { opacity: 1, translateX: 0, translateY: 0, scale: 1 };
const GONE: Pose = { ...REST, opacity: 0 };

/** The flyout's offset for a side: out of the side it opens from. */
function offset(side: Side): { translateX: number; translateY: number } {
  const t = flyout.travel;
  return {
    translateX: side === 'right' ? -t : side === 'left' ? t : 0,
    translateY: side === 'top' ? t : side === 'bottom' ? -t : 0,
  };
}

/**
 * Every preset, for one reduce-motion setting.
 *
 * Reduced motion is about travel, not change: slides and sheets become
 * cross-fades, a press becomes a colour change instead of a scale, a layout
 * change jumps. Spinners are not here because they stay: they are meaning.
 */
export interface MotionPresets {
  press: { scale: number; tint: boolean; transition: Timing };
  popoverIn: (side: Side) => Motion;
  popoverOut: (side: Side) => Motion;
  sheet: { slide: boolean; enter: Transition; exit: Transition };
  fadeRise: Motion & { transition: Timing };
  layout: Spring | null;
}

export function motionPresets(reduced: boolean): MotionPresets {
  const fadeIn = timing(durations.fast, easings.standard);
  const fadeOut = timing(durations.fast, easings.standard);

  return {
    /** A control under a finger. `tint`: show the pressed colour instead of moving. */
    press: reduced
      ? { scale: 1, tint: true, transition: timing(durations.instant, easings.standard) }
      : {
          scale: PRESS_SCALE,
          tint: false,
          transition: timing(durations.instant, easings.standard),
        },

    /** A menu, a popover, a select's list, a hover card: the web flyout's motion. */
    popoverIn(side: Side): Motion {
      if (reduced) return { from: GONE, to: REST, transition: fadeIn };
      return {
        from: { opacity: 0, ...offset(side), scale: flyout.scaleIn },
        to: REST,
        transition: timing(durations.normal, easings.entrance),
      };
    },
    popoverOut(side: Side): Motion {
      if (reduced) return { from: REST, to: GONE, transition: fadeOut };
      const { translateX, translateY } = offset(side);
      return {
        from: REST,
        to: {
          opacity: 0,
          translateX: translateX * flyout.exitTravel,
          translateY: translateY * flyout.exitTravel,
          scale: flyout.scaleOut,
        },
        transition: timing(durations.fast, easings.exit),
      };
    },

    /**
     * A sheet. It travels its own height from the edge it is anchored to, so
     * the distance belongs to the sheet: `slide` says whether to travel at all.
     * In on the gentle spring, out at `fast`.
     */
    sheet: reduced
      ? { slide: false, enter: fadeIn, exit: fadeOut }
      : {
          slide: true,
          enter: physics(gentleSpring),
          exit: timing(durations.fast, easings.exit),
        },

    /** Content arriving: a fade and a rise of half a rem. */
    fadeRise: {
      from: reduced ? GONE : { ...GONE, translateY: RISE },
      to: REST,
      transition: reduced ? fadeIn : timing(durations.normal, easings.entrance),
    } satisfies Motion,

    /** A view moving to a new place in a layout. `null`: jump there. */
    layout: reduced ? null : physics(springs.move),
  };
}

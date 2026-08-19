/*
 * Spring physics.
 *
 * Two consumers, and they need different things from the same numbers:
 *
 *   Declarative motion (a switch thumb, a menu opening) is predetermined. It
 *   wants to run as a CSS transition so it stays on the compositor and keeps
 *   its frames while the main thread is busy parsing a 200-row payroll
 *   response. `springEasing` solves the spring once and samples it into a
 *   `linear()` easing, which is a spring curve a CSS transition can use.
 *
 *   Gesture motion (dragging a sheet) is not predetermined. It has to start
 *   from wherever the finger left the element and carry the finger's velocity
 *   into the settle, so it needs the spring stepped frame by frame. `stepSpring`
 *   does that, and `use-drag-dismiss.ts` drives it off requestAnimationFrame.
 *
 * The parameterisation is Apple's, not the physics textbook's. `mass`,
 * `stiffness` and `damping` are three coupled numbers where changing one
 * silently changes how the other two feel; `damping` (does it overshoot?) and
 * `response` (how quickly does it get there?) are independent, so a designer
 * can move one without re-tuning the other.
 *
 * Damping is a *ratio*: 1 is critically damped, the fastest approach that never
 * overshoots. Below 1 overshoots and oscillates. Above 1 crawls in. Response is
 * the natural period in seconds, which is not a duration, a spring has no
 * duration, it has a settle time that falls out of the two parameters.
 */

/** Spring parameters, in Apple's damping/response form. */
export interface SpringConfig {
  /**
   * Damping ratio. 1 never overshoots; ~0.8 overshoots a little; below ~0.6
   * reads as wobble rather than as physics.
   *
   * Default to 1 for anything that merely appeared. Overshoot is the interface
   * saying "you threw this", so it is earned by a gesture that carried
   * momentum, and it is a lie on a menu that just faded in.
   */
  damping: number;
  /** Natural period, in seconds. Lower is snappier. */
  response: number;
}

/**
 * The values Apple ships, and the only ones a component should reach for
 * without a reason. A system with eleven springs has no springs, it has
 * eleven durations wearing a costume.
 */
export const springs = {
  /**
   * Small, frequent, and in a hurry: a switch thumb, a tab indicator, a chip
   * landing. Settles in ~256ms, which keeps it inside the budget where an
   * interface still reads as responding rather than as animating.
   *
   * Apple's own move spring is `response 0.4`, and this is deliberately faster.
   * That number is tuned for a phone where a repositioning window is the only
   * thing on screen; a payroll register showing forty controls that each moved
   * at 0.4 feels like wading. Density buys speed.
   */
  snap: { damping: 1, response: 0.15 },
  /**
   * Something larger repositioning: a panel, a rail collapsing, a card moving
   * to a new column. Slower than `snap` because the object is bigger and a big
   * object that moves at a small object's speed reads as weightless.
   */
  move: { damping: 1, response: 0.25 },
  /**
   * A drawer or sheet settling. Slightly under-damped, because by the time this
   * runs the user has already flicked the panel and the overshoot is the
   * momentum they put into it.
   */
  drawer: { damping: 0.8, response: 0.3 },
  /**
   * Something the user threw. The bounciest thing in the system, and it is only
   * ever correct immediately after a release with real velocity. Never on an
   * element that merely appeared.
   */
  flick: { damping: 0.75, response: 0.35 },
} as const satisfies Record<string, SpringConfig>;

export type SpringName = keyof typeof springs;

/** Live state of a spring being stepped. `x` is the current value. */
export interface SpringState {
  x: number;
  v: number;
}

/*
 * Analytic solution for a unit step: the spring starts at 0, targets 1, and we
 * ask where it is at time `t`. Analytic rather than integrated because
 * `springEasing` samples the same curve dozens of times and an integrator would
 * accumulate a different answer at each sample rate.
 */
function unitStep(config: SpringConfig, t: number): number {
  const { damping: zeta, response } = config;
  // Natural angular frequency. `response` is the period, so this is the
  // radians-per-second that period implies.
  const omega = (2 * Math.PI) / response;

  if (zeta < 1) {
    // Under-damped: decaying envelope times an oscillation.
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
  }

  if (zeta === 1) {
    // Critically damped. The `(1 + omega * t)` term is why this approaches the
    // target without ever crossing it.
    const decay = Math.exp(-omega * t);
    return 1 - decay * (1 + omega * t);
  }

  // Over-damped: two real exponentials, the slower one dominates the tail.
  const rate = omega * Math.sqrt(zeta * zeta - 1);
  const a = -zeta * omega + rate;
  const b = -zeta * omega - rate;
  return 1 - (b * Math.exp(a * t) - a * Math.exp(b * t)) / (b - a);
}

/**
 * How long until the spring is close enough that the remaining motion is below
 * a pixel on a normal-sized element. Springs approach asymptotically, so
 * "finished" is a tolerance, not an event.
 */
export function springSettleTime(config: SpringConfig, epsilon = 0.001): number {
  // 4ms steps: fine enough that the reported time is within a frame of the
  // true crossing, coarse enough to stay cheap when a story renders 40 of them.
  const step = 0.004;
  const limit = 10;
  let t = 0;
  let settledFor = 0;

  while (t < limit) {
    t += step;
    if (Math.abs(1 - unitStep(config, t)) < epsilon) {
      // Require the tolerance to hold for a stretch, not for one sample: an
      // under-damped spring passes through the target on its way to overshoot
      // and would otherwise report settled at the first crossing.
      settledFor += step;
      if (settledFor >= config.response / 2) return t;
    } else {
      settledFor = 0;
    }
  }

  return limit;
}

/**
 * Samples a spring into a CSS `linear()` easing.
 *
 * `linear()` takes a list of output values and interpolates between them, so a
 * curve of any shape, including one that goes past 1 and comes back, survives
 * as a plain easing function. That is the whole trick: it buys spring feel for
 * a CSS transition, which means the motion runs on the compositor and is
 * interruptible and retargetable the way a keyframe animation is not.
 *
 * The cost is that the curve is baked at a fixed duration. Pair the returned
 * easing with the matching `springSettleTime` and nothing looks wrong; use it
 * with an arbitrary duration and an overshoot lands in the wrong place.
 *
 * Not for gesture motion. A baked curve cannot accept the release velocity of
 * a drag, which is the one thing that makes a flick feel thrown.
 */
export function springEasing(config: SpringConfig, samples = 20): string {
  /*
   * A looser tolerance than `springSettleTime`'s default on purpose. The last
   * half-percent of a critically damped spring takes about as long as the first
   * ninety, and baking it means the CSS `transition-duration` is a number the
   * user waits out long after the element has visibly stopped. Four parts in a
   * thousand is a third of a pixel on a 100px move: invisible, and it cuts the
   * quoted duration by the dead tail.
   */
  const duration = springSettleTime(config, 0.004);
  const points: string[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const t = (i / samples) * duration;
    const value = i === samples ? 1 : unitStep(config, t);
    // Three decimals is under a tenth of a pixel on a 100px move, and keeps the
    // emitted string short enough to read in a stylesheet.
    points.push(Number(value.toFixed(3)).toString());
  }

  return `linear(${points.join(', ')})`;
}

/**
 * Advances a spring by one frame.
 *
 * Semi-implicit Euler. It is one line, unconditionally stable at the step sizes
 * a display produces, and unlike the analytic form above it accepts an
 * arbitrary starting position *and* velocity, which is exactly what a gesture
 * handing off to an animation needs.
 *
 * `dt` is seconds. Clamp it before calling: a backgrounded tab resumes with a
 * multi-second delta and an unclamped step teleports the element.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const omega = (2 * Math.PI) / config.response;
  // Standard mass-spring-damper with mass folded to 1, which is what lets the
  // two-parameter form work: stiffness is omega², damping is 2*zeta*omega.
  const stiffness = omega * omega;
  const damper = 2 * config.damping * omega;

  const acceleration = -stiffness * (state.x - target) - damper * state.v;
  const v = state.v + acceleration * dt;

  return { x: state.x + v * dt, v };
}

/** True once the spring is close enough to its target to stop stepping. */
export function isSpringSettled(
  state: SpringState,
  target: number,
  // Thresholds in the caller's units. The defaults suit pixels: a tenth of a
  // pixel of offset and a pixel per second of velocity are both invisible.
  { distance = 0.1, velocity = 1 } = {},
): boolean {
  return Math.abs(state.x - target) < distance && Math.abs(state.v) < velocity;
}

/**
 * Where a flick is heading.
 *
 * Do not snap from the point the finger left, snap from the point the gesture
 * was *going*. A quick flick that only travelled 20px should still dismiss a
 * panel, because the user's intent is in the velocity, not in the distance.
 *
 * This is the exponential-decay form from Apple's own sample code, and it is
 * deliberately not the textbook `v²/(2a)`. Scroll deceleration is exponential,
 * so this is the function that makes a thrown panel land where a thrown scroll
 * view would have landed.
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary.
 *
 * A hard stop reads as a frozen interface; the user cannot tell "there is
 * nothing more here" from "the app hung". Resistance that grows with the
 * overshoot says the first thing, and it is what iOS scroll views do at the
 * top of a list.
 *
 * `dimension` is the size of the thing being dragged, so the resistance scales
 * with the object rather than being tuned per component.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isSpringSettled,
  projectMomentum,
  rubberband,
  springEasing,
  springs,
  springSettleTime,
  stepSpring,
} from './spring';

/*
 * The physics is the source of truth and `preset.css` is a copy of it. A copy
 * with no test is a copy that drifts, so the last block here re-derives every
 * easing and asserts the stylesheet still holds what the solver produces.
 */

describe('unit step', () => {
  it('starts at rest and reaches the target', () => {
    // Sampling the easing is the only view onto `unitStep`, which is private.
    for (const config of Object.values(springs)) {
      const easing = springEasing(config, 8);
      const values = easing
        .slice('linear('.length, -1)
        .split(', ')
        .map((n) => Number(n));

      expect(values[0]).toBe(0);
      expect(values.at(-1)).toBe(1);
    }
  });

  it('never overshoots when critically damped', () => {
    for (const name of ['snap', 'move'] as const) {
      const values = springEasing(springs[name], 40)
        .slice('linear('.length, -1)
        .split(', ')
        .map((n) => Number(n));

      // A damping ratio of exactly 1 is the fastest approach that does not
      // cross the target. Anything above 1 here means the solver is wrong.
      for (const value of values) expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('overshoots when under-damped, and only just', () => {
    for (const name of ['drawer', 'flick'] as const) {
      const values = springEasing(springs[name], 40)
        .slice('linear('.length, -1)
        .split(', ')
        .map((n) => Number(n));
      const peak = Math.max(...values);

      expect(peak).toBeGreaterThan(1);
      // Past ~8% the overshoot stops reading as momentum and starts reading as
      // a bug in the interface.
      expect(peak).toBeLessThan(1.08);
    }
  });

  it('rises monotonically to the first crossing', () => {
    const values = springEasing(springs.snap, 40)
      .slice('linear('.length, -1)
      .split(', ')
      .map((n) => Number(n));

    // Reduce over adjacent pairs rather than indexing, so the assertion needs
    // no claim about the array's bounds.
    for (const [previous, current] of values.slice(1).map((v, i) => [values[i], v] as const)) {
      expect(current).toBeGreaterThanOrEqual(previous ?? 0);
    }
  });
});

describe('settle time', () => {
  it('is ordered by response', () => {
    // Response is the natural period, so a longer one must take longer to
    // settle. If this inverts, the two parameters are coupled and the whole
    // point of the parameterisation is gone.
    expect(springSettleTime(springs.snap)).toBeLessThan(springSettleTime(springs.move));
    expect(springSettleTime(springs.move)).toBeLessThan(springSettleTime(springs.drawer));
  });

  it('keeps the frequent springs inside the responsiveness budget', () => {
    // The one number in this file with a product argument behind it rather than
    // a physical one: past ~300ms a control that fires on every click stops
    // feeling like feedback.
    expect(springSettleTime(springs.snap, 0.004)).toBeLessThan(0.3);
  });

  it('does not report settled at an under-damped spring first crossing', () => {
    // A bouncy spring passes through its target on the way to the overshoot.
    // Reporting that moment as settled truncates the easing mid-bounce.
    const settle = springSettleTime(springs.flick, 0.004);
    const values = springEasing(springs.flick, 40)
      .slice('linear('.length, -1)
      .split(', ')
      .map((n) => Number(n));

    expect(settle).toBeGreaterThan(springs.flick.response);
    expect(Math.max(...values)).toBeGreaterThan(1);
  });
});

describe('stepSpring', () => {
  it('converges on the target from rest', () => {
    let state = { x: 0, v: 0 };
    for (let i = 0; i < 600; i += 1) state = stepSpring(state, 100, springs.move, 1 / 60);

    expect(state.x).toBeCloseTo(100, 1);
    expect(isSpringSettled(state, 100)).toBe(true);
  });

  it('carries an initial velocity into the motion', () => {
    // The gesture handoff. A spring given the finger's release velocity must
    // travel further on the first frames than one starting from rest,
    // otherwise there is a visible seam where the drag becomes an animation.
    const thrown = stepSpring({ x: 0, v: 800 }, 0, springs.flick, 1 / 60);
    const still = stepSpring({ x: 0, v: 0 }, 0, springs.flick, 1 / 60);

    expect(thrown.x).toBeGreaterThan(still.x);
  });

  it('settles even when handed a large velocity', () => {
    let state = { x: 0, v: 4000 };
    for (let i = 0; i < 900; i += 1) state = stepSpring(state, 0, springs.drawer, 1 / 60);

    expect(isSpringSettled(state, 0)).toBe(true);
  });

  it('stays finite at a frame duration a stalled tab can produce', () => {
    // Semi-implicit Euler is stable across the range a display produces, but a
    // caller that forgets to clamp `dt` is the likely bug, so pin the
    // behaviour rather than the hope.
    const state = stepSpring({ x: 0, v: 0 }, 100, springs.move, 1 / 30);
    expect(Number.isFinite(state.x)).toBe(true);
    expect(Number.isFinite(state.v)).toBe(true);
  });
});

describe('projectMomentum', () => {
  it('scales with velocity and keeps its sign', () => {
    expect(projectMomentum(1000)).toBeGreaterThan(projectMomentum(500));
    expect(projectMomentum(-1000)).toBeLessThan(0);
    expect(projectMomentum(0)).toBe(0);
  });

  it('projects a flick far past where the finger stopped', () => {
    // The whole reason this function exists: a 20px flick at 900px/s has to
    // dismiss a panel, because the intent is in the velocity.
    expect(projectMomentum(900)).toBeGreaterThan(300);
  });

  it('travels less at a snappier deceleration rate', () => {
    expect(projectMomentum(900, 0.99)).toBeLessThan(projectMomentum(900, 0.998));
  });
});

describe('rubberband', () => {
  it('resists more the further past the boundary', () => {
    const near = rubberband(50, 400);
    const far = rubberband(400, 400);

    // Follows the finger, but never 1:1, that is the resistance.
    expect(near).toBeLessThan(50);
    expect(far).toBeLessThan(400);
    // And the ratio tightens as the overshoot grows.
    expect(far / 400).toBeLessThan(near / 50);
  });

  it('is symmetric and pinned at zero', () => {
    expect(rubberband(-50, 400)).toBeCloseTo(-rubberband(50, 400), 6);
    expect(rubberband(0, 400)).toBe(0);
  });

  it('returns zero for an unmeasured element rather than dividing by zero', () => {
    expect(rubberband(50, 0)).toBe(0);
  });
});

describe('preset.css', () => {
  const css = readFileSync(join(import.meta.dirname, '../styles/preset.css'), 'utf8');

  it.each(Object.entries(springs))(
    'holds the solved curve for --ease-spring-%s',
    (name, config) => {
      const expected = springEasing(config);
      /*
       * Prettier breaks a 21-argument `linear()` across 21 lines, so the
       * stylesheet never contains the solver's one-line form literally. Collapse
       * runs of whitespace, then close up the padding the line breaks left inside
       * the brackets, and the two are comparable again.
       */
      const normalised = css
        .replace(/\s+/g, ' ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .replace(/\s+,/g, ',');

      expect(normalised).toContain(`--ease-spring-${name}: ${expected};`);
    },
  );

  it.each(Object.entries(springs))('holds the matching settle duration for %s', (name, config) => {
    const ms = Math.round(springSettleTime(config, 0.004) * 1000).toString();

    // A baked curve is only correct at the duration it was baked for. An
    // overshoot paired with someone else's duration lands in the wrong place.
    expect(css).toContain(`--animate-duration-spring-${name}: ${ms}ms;`);
  });
});

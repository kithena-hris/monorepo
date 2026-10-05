import {
  durations,
  easings,
  flyout,
  gentleSpring,
  PRESS_SCALE,
  RISE,
  springs,
} from '@reach/ui/motion';
import { describe, expect, it } from 'vitest';

import { motionPresets, physics } from './motion.ts';

describe('the native presets use the shared values', () => {
  const presets = motionPresets(false);

  it('press: the web button’s scale, at the instant duration', () => {
    expect(presets.press.scale).toBe(PRESS_SCALE);
    expect(presets.press.transition).toEqual({
      type: 'timing',
      duration: durations.instant,
      easing: easings.standard,
    });
  });

  it('popover: the flyout, in at normal with the entrance curve, out at fast with the exit', () => {
    const opening = presets.popoverIn('bottom');
    expect(opening.from).toEqual({
      opacity: 0,
      translateX: 0,
      translateY: -flyout.travel,
      scale: flyout.scaleIn,
    });
    expect(opening.transition).toEqual({
      type: 'timing',
      duration: durations.normal,
      easing: easings.entrance,
    });

    const closing = presets.popoverOut('right');
    expect(closing.to).toEqual({
      opacity: 0,
      translateX: -flyout.travel * flyout.exitTravel,
      translateY: 0,
      scale: flyout.scaleOut,
    });
    expect(closing.transition).toEqual({
      type: 'timing',
      duration: durations.fast,
      easing: easings.exit,
    });
  });

  it('sheet: in on the gentle spring, out at fast', () => {
    expect(presets.sheet.slide).toBe(true);
    expect(presets.sheet.enter).toEqual(physics(gentleSpring));
    expect(presets.sheet.exit).toEqual({
      type: 'timing',
      duration: durations.fast,
      easing: easings.exit,
    });
  });

  it('fade and rise: the rise, at normal', () => {
    expect(presets.fadeRise.from.translateY).toBe(RISE);
    expect(presets.fadeRise.transition.duration).toBe(durations.normal);
  });

  it('layout: the move spring', () => {
    expect(presets.layout).toEqual(physics(springs.move));
  });

  it('converts a spring the way stepSpring does', () => {
    const omega = (2 * Math.PI) / 0.3;
    expect(physics({ damping: 0.8, response: 0.3 })).toEqual({
      type: 'spring',
      mass: 1,
      stiffness: omega * omega,
      damping: 2 * 0.8 * omega,
    });
  });
});

describe('under reduced motion', () => {
  const reduced = motionPresets(true);

  it('a press changes colour instead of scale', () => {
    expect(reduced.press.scale).toBe(1);
    expect(reduced.press.tint).toBe(true);
  });

  it('overlays and sheets cross-fade instead of travelling', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      for (const motion of [reduced.popoverIn(side), reduced.popoverOut(side)]) {
        for (const pose of [motion.from, motion.to]) {
          expect(pose).toMatchObject({ translateX: 0, translateY: 0, scale: 1 });
        }
      }
    }
    expect(reduced.sheet.slide).toBe(false);
    expect(reduced.sheet.enter.type).toBe('timing');
  });

  it('content arrives without rising, and a layout change jumps', () => {
    expect(reduced.fadeRise.from.translateY).toBe(0);
    expect(reduced.layout).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  durations,
  easings,
  flyout,
  gentleSpring,
  PRESS_SCALE,
  RISE,
  springs,
  stagger,
} from './motion';

/*
 * `motion.ts` is the source; `theme.css` is the web's copy of it, in the form
 * a stylesheet can use. The phone reads the module directly, so a value
 * changed on one side only would make the two libraries move differently.
 * These tests are what stop that.
 */
const theme = readFileSync(join(__dirname, '../styles/theme.css'), 'utf8');

function declared(property: string): string | undefined {
  return new RegExp(`${property}:\\s*([^;]+);`).exec(theme)?.[1]?.trim();
}

describe('theme.css agrees with motion.ts', () => {
  it('on every duration', () => {
    for (const [name, ms] of Object.entries(durations)) {
      expect(declared(`--animate-duration-${name}`)).toBe(`${String(ms)}ms`);
    }
  });

  it('on every easing', () => {
    for (const [name, points] of Object.entries(easings)) {
      expect(declared(`--ease-${name}`)).toBe(`cubic-bezier(${points.join(', ')})`);
    }
  });

  it('on the flyout every overlay shares', () => {
    expect(theme).toContain(
      `transform: translate(var(--flyout-x, -${String(flyout.travel)}px), var(--flyout-y, 0px)) scale(${String(flyout.scaleIn)});`,
    );
    expect(theme).toContain(`* ${String(flyout.exitTravel)})`);
    expect(theme).toContain(`scale(${String(flyout.scaleOut)});`);
    expect(declared('--animate-flyout-in')).toBe(
      'flyout-in var(--animate-duration-normal) var(--ease-entrance)',
    );
    expect(declared('--animate-flyout-out')).toBe(
      'flyout-out var(--animate-duration-fast) var(--ease-exit)',
    );
  });

  it('on the stagger step and its ceiling', () => {
    expect(declared('--animate-stagger-step')).toBe(`${String(stagger.step)}ms`);
    expect(declared('--animate-stagger-max')).toBe(`${String(stagger.max)}ms`);
  });

  it('on the rise content arrives from', () => {
    expect(theme).toContain(`transform: translateY(${String(RISE / 16)}rem);`);
  });
});

it('the gentle spring is the drawer spring, the one the web settles a sheet with', () => {
  expect(gentleSpring).toBe(springs.drawer);
});

it('the web button presses to the shared scale', () => {
  const button = readFileSync(join(__dirname, '../components/button/button.tsx'), 'utf8');
  expect(button).toContain(`active:scale-[${String(PRESS_SCALE)}]`);
});

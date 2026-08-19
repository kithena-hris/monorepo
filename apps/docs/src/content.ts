/**
 * The catalogue, mirrored from Storybook's index.
 *
 * Written out rather than fetched: this page is a static build and Storybook
 * sits behind authentication, so a request for its index at load time would
 * fail for exactly the readers this page is for. `pnpm docs:catalogue-drift`
 * compares the two and fails if a component is added without landing here.
 */

import catalogue from './catalogue.json';

export type Category = {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly items: readonly string[];
};

/**
 * A stable alias, not the deployment URL. Every Storybook deploy mints a new
 * preview host, and pointing this page at one of those would break the link on
 * the next deploy. The alias is reassigned instead, so this constant does not
 * move.
 */
export const STORYBOOK_URL = 'https://reach-storybook.vercel.app';

export const STORY_COUNT = 372;

/**
 * Held as JSON so `pnpm docs:catalogue-drift` can read it without importing the
 * application bundle, the same arrangement the manager theme uses.
 */
export const CATEGORIES: readonly Category[] = catalogue;

export type Principle = {
  readonly title: string;
  readonly body: string;
};

export const PRINCIPLES: readonly Principle[] = [
  {
    title: 'Semantic tokens only',
    body: 'Components consume `bg-surface`, never `bg-neutral-100`. Renaming a primitive then costs nothing, while renaming a semantic token is a breaking change you can find and fix. The indirection is the point.',
  },
  {
    title: 'Colour is never the only signal',
    body: 'Roughly one man in twelve cannot separate the success and danger washes. Every state that matters carries a label, an icon or a shape as well, and the charts print their values as text beside the marks.',
  },
  {
    title: 'Money is never a float',
    body: 'Minor units in, exact string formatting out. `Number()` loses cents at the fifteenth digit and payroll does not tolerate rounding, so the boundary between a number and a currency is enforced by the type.',
  },
  {
    title: 'Density follows the pointer, not the screen',
    body: 'A `size="md"` control is 36px under a mouse and 44px under a thumb. Control heights come from `--reach-control-*`, which re-points under `@media (pointer: coarse)`. No component asks how wide the window is, because a 1920px television is not a 1920px monitor.',
  },
  {
    title: 'The system stays presentational',
    body: 'It imports no contract, no domain type and no data client. A module composes screens out of the system; it never teaches the system what a Person is. Both directions are enforced by dependency-cruiser, not by convention.',
  },
];

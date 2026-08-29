import * as z from 'zod';

import { asPublic, policy } from './classification.js';

/**
 * The accents a customer may choose, as a closed list.
 *
 * A free colour field was the previous design and it is the wrong shape for
 * this. The accent re-points `--reach-color-accent`, which the design system
 * puts behind white text on buttons and badges — so an arbitrary colour is an
 * arbitrary contrast ratio, and roughly half of the ones a person picks fail
 * WCAG AA against white. `pnpm test-stories` runs axe over every story as a
 * merge gate, and it would be strange to enforce contrast on our own components
 * and then let a customer set an accent that fails it on their login page.
 *
 * Each of these was chosen at a lightness where white text clears 4.5:1. The
 * values are oklch for the same reason the token ramps are: equal lightness
 * numbers look equally light across hues, which is what makes a set like this
 * feel like one family rather than six unrelated colours.
 *
 * This is presentation, so it could have lived in `packages/ui`. It lives here
 * because the *choice* is tenant data — it is stored, it is exported in a DSAR
 * package, and `packages/ui` may not import a contract. The design system
 * consumes a colour; it does not need to know the list exists.
 */
export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  /**
   * The hue angle every colour below sits on, in oklch degrees.
   *
   * Stated as a number because the design system needs the *ramp*, not the five
   * colours. Reach derives `--reach-brand-50` through `--reach-brand-950` from
   * this one angle, and every accent token in both light and dark themes is
   * already defined in terms of that ramp — so re-pointing the hue themes a
   * customer's entire surface, including the dark scheme and the focus ring,
   * rather than the four places somebody remembered to override.
   *
   * The five colours below stay because an email cannot resolve a CSS variable
   * and needs literal values. `branding.test.ts` asserts the hue and `accent`
   * agree, which is the same copy-and-check trade as `reach-tokens.json`.
   */
  readonly hue: number;
  /** The accent itself, and what a button is filled with. */
  readonly accent: string;
  /** Hover and active, one and two steps darker. */
  readonly accentHover: string;
  readonly accentActive: string;
  /** The wash behind subtle badges and selected rows. */
  readonly accentSubtle: string;
  /** Text on that wash. Dark, unlike the text on the solid fill. */
  readonly accentFg: string;
  /**
   * Contrast of `accent` against white, computed rather than eyeballed:
   * oklch to linear sRGB, then the WCAG relative-luminance formula.
   * `branding.test.ts` recomputes these and fails if one drops below 4.5, so a
   * retuned preset cannot quietly stop being legible.
   */
  readonly contrastOnWhite: number;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'indigo',
    hue: 264,
    name: 'Indigo',
    accent: 'oklch(0.55 0.18 264)',
    accentHover: 'oklch(0.48 0.17 264)',
    accentActive: 'oklch(0.42 0.15 264)',
    accentSubtle: 'oklch(0.96 0.02 264)',
    accentFg: 'oklch(0.38 0.14 264)',
    contrastOnWhite: 5.02,
  },
  {
    id: 'teal',
    hue: 195,
    name: 'Teal',
    accent: 'oklch(0.52 0.11 195)',
    accentHover: 'oklch(0.46 0.1 195)',
    accentActive: 'oklch(0.4 0.09 195)',
    accentSubtle: 'oklch(0.96 0.02 195)',
    accentFg: 'oklch(0.36 0.08 195)',
    contrastOnWhite: 5.05,
  },
  {
    id: 'forest',
    hue: 156,
    name: 'Forest',
    accent: 'oklch(0.5 0.12 156)',
    accentHover: 'oklch(0.44 0.11 156)',
    accentActive: 'oklch(0.38 0.1 156)',
    accentSubtle: 'oklch(0.96 0.02 156)',
    accentFg: 'oklch(0.35 0.09 156)',
    contrastOnWhite: 5.65,
  },
  {
    id: 'plum',
    hue: 320,
    name: 'Plum',
    accent: 'oklch(0.5 0.16 320)',
    accentHover: 'oklch(0.44 0.15 320)',
    accentActive: 'oklch(0.38 0.13 320)',
    accentSubtle: 'oklch(0.96 0.02 320)',
    accentFg: 'oklch(0.36 0.13 320)',
    contrastOnWhite: 6.54,
  },
  {
    id: 'clay',
    hue: 40,
    name: 'Clay',
    accent: 'oklch(0.52 0.14 40)',
    accentHover: 'oklch(0.46 0.13 40)',
    accentActive: 'oklch(0.4 0.12 40)',
    accentSubtle: 'oklch(0.96 0.02 40)',
    accentFg: 'oklch(0.37 0.11 40)',
    contrastOnWhite: 5.86,
  },
  {
    id: 'slate',
    hue: 250,
    name: 'Slate',
    accent: 'oklch(0.45 0.03 250)',
    accentHover: 'oklch(0.39 0.03 250)',
    accentActive: 'oklch(0.33 0.03 250)',
    accentSubtle: 'oklch(0.96 0.005 250)',
    accentFg: 'oklch(0.32 0.03 250)',
    contrastOnWhite: 7.42,
  },
];

const BY_ID = new Map(THEME_PRESETS.map((t) => [t.id, t]));

export function themePreset(id: string): ThemePreset | undefined {
  return BY_ID.get(id);
}

/**
 * Stored as the preset's id, not its colour.
 *
 * An id survives the day a preset is retuned — every customer on Indigo moves
 * with it. A stored `oklch(...)` would pin them to whatever the value was on
 * the afternoon they signed up, and there would be no way to tell a deliberate
 * custom colour from a stale copy of a preset.
 */
export const ThemeId = z
  .string()
  .refine((id) => BY_ID.has(id), 'that is not one of the available themes')
  .register(policy, asPublic());
export type ThemeId = z.infer<typeof ThemeId>;

/** The default for a company that never opened the theme step. */
export const DEFAULT_THEME_ID = 'indigo';

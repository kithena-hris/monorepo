import { create, type ThemeVars } from 'storybook/theming';

import { reachMarkDataUri } from '@reach/ui/brand/mark-data-uri';

import tokens from './reach-tokens.json';

/**
 * Storybook's own chrome, wearing Reach's colours.
 *
 * ### Why these are hex literals rather than `var(--reach-color-…)`
 *
 * The manager is a separate document from the preview iframe and it does not
 * load the design system's stylesheet, so nothing here can resolve a Reach
 * custom property. Storybook's theme is a plain object of concrete values
 * consumed by emotion inside the manager bundle: the tokens have to arrive
 * already resolved.
 *
 * `reach-tokens.json` is therefore a copy, and a copy of a colour is a thing
 * that goes stale silently. `tools/storybook/manager-theme-drift.mjs` reads the
 * real stylesheet in a browser and fails if any entry no longer matches the
 * token it is keyed by, which is what makes the copy safe to keep. It is JSON
 * rather than TypeScript so that the check can read it without importing the
 * Storybook bundle.
 *
 * Every colour below is referenced through `SNAPSHOT`, never written twice, so
 * the drift check covers all of them.
 */
// No cast: the JSON's inferred literal types are what let the properties be
// reached by name, and what keeps `exactOptionalPropertyTypes` satisfied when
// they are handed to `create()`.
const SNAPSHOT = tokens;

const brand = {
  brandTitle: 'Reach UI',
  brandUrl: '/',
  brandImage: reachMarkDataUri,
  brandTarget: '_self' as const,
};

/** `--radius-md` and `--radius-sm` in px. Storybook wants numbers, not rems. */
const RADIUS_MD = 8;
const RADIUS_SM = 6;

const FONT_SANS = "'InterVariable', 'Inter', ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

/**
 * One theme definition, used by two surfaces.
 *
 * The manager chrome and the docs canvas are separate Storybook themes, and
 * left to themselves they drift: the sidebar follows the toggle while the props
 * tables stay white. Both are built here so a token moves in one place.
 *
 * `withBrand` is false for the docs canvas, which has no sidebar to put a logo
 * in.
 */
export function buildReachTheme(mode: 'light' | 'dark', withBrand = true): ThemeVars {
  const t = SNAPSHOT[mode];
  return create({
    base: mode,
    ...(withBrand ? brand : {}),

    colorPrimary: t.accent,
    /*
     * In the manager this paints the selected sidebar row, a filled surface, so
     * it wants the solid tone. On a docs page Storybook uses the same value as
     * *text*, for the active entry in the table of contents, where a solid
     * accent measures 3.7:1 on the dark canvas. Same distinction the charts and
     * the rating make between a tone to sit under and a tone to read.
     */
    colorSecondary: withBrand ? t['accent-solid'] : t['accent-fg'],

    appBg: t['surface-sunken'], // sidebar and the area around the preview
    appContentBg: t.surface,
    appPreviewBg: t.surface,
    appBorderColor: t.border,
    appBorderRadius: RADIUS_MD,

    fontBase: FONT_SANS,
    fontCode: FONT_MONO,

    textColor: t.fg,
    textInverseColor: mode === 'light' ? t['fg-on-solid'] : t.surface,
    textMutedColor: t['fg-muted'],

    barTextColor: t['fg-muted'],
    barHoverColor: t.accent,
    // Text on the toolbar sits on `surface`, so it takes the `-fg` end of the
    // ramp for the same reason the charts and the rating do.
    barSelectedColor: t['accent-fg'],
    barBg: t.surface,

    inputBg: t.surface,
    inputBorder: t['border-strong'],
    inputTextColor: t.fg,
    inputBorderRadius: RADIUS_SM,
  });
}

export const lightTheme = buildReachTheme('light');
export const darkTheme = buildReachTheme('dark');

/** The same palette, for the docs canvas. */
export const lightDocsTheme = buildReachTheme('light', false);
export const darkDocsTheme = buildReachTheme('dark', false);

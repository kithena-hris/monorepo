import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_ID, THEME_PRESETS, ThemeId, themePreset } from './branding.js';

/**
 * The accent goes behind white text on every filled button on a customer's
 * login page, so "does it look nice" is not the question — the question is
 * whether it clears 4.5:1, and that is arithmetic rather than taste.
 *
 * Recomputed here rather than trusted from the table. A preset retuned by hand
 * is exactly the change that would leave a stale number next to a colour that
 * no longer earns it.
 */

/** oklch to linear-light sRGB. The matrices are the Oklab specification's. */
function oklchToLinearSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * WCAG relative luminance takes linear-light channels, which is what the
 * conversion above already produces — so there is no gamma decode here, and its
 * absence is deliberate rather than forgotten.
 */
function relativeLuminance(oklch: string): number {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(oklch);
  if (!match) throw new Error(`not an oklch triple this test can read: ${oklch}`);
  const [r, g, b] = oklchToLinearSrgb(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ).map((v) => Math.max(0, Math.min(1, v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrastAgainstWhite = (colour: string): number => 1.05 / (relativeLuminance(colour) + 0.05);

/** The third component of an oklch triple, which is the hue angle. */
function hueOf(colour: string): number {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(colour);
  if (!match) throw new Error(`not an oklch triple this test can read: ${colour}`);
  return Number(match[3]);
}

describe('theme presets', () => {
  it.each(THEME_PRESETS.map((t) => [t.id, t] as const))(
    '%s carries white text at AA',
    (_id, preset) => {
      expect(contrastAgainstWhite(preset.accent)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(THEME_PRESETS.map((t) => [t.id, t] as const))(
    '%s states its real contrast',
    (_id, preset) => {
      // Two decimal places, because that is the precision the table claims.
      expect(contrastAgainstWhite(preset.accent)).toBeCloseTo(preset.contrastOnWhite, 2);
    },
  );

  it.each(THEME_PRESETS.map((t) => [t.id, t] as const))(
    '%s darkens rather than lightens on hover',
    (_id, preset) => {
      // A hover state that got lighter would drop contrast at the moment a
      // pointer is on the control, which is when it is being read.
      expect(relativeLuminance(preset.accentHover)).toBeLessThan(relativeLuminance(preset.accent));
      expect(relativeLuminance(preset.accentActive)).toBeLessThan(
        relativeLuminance(preset.accentHover),
      );
    },
  );

  it.each(THEME_PRESETS.map((t) => [t.id, t] as const))(
    '%s states the hue its colours are actually on',
    (_id, preset) => {
      /*
       * The hue is a second copy of something the five colours already encode,
       * kept because Reach needs an angle and an email needs literals. This is
       * the check that keeps the copy honest: retune a preset to a new hue and
       * forget the number, and this fails rather than shipping a login page
       * whose buttons are teal and whose focus ring is still indigo.
       */
      for (const colour of [
        preset.accent,
        preset.accentHover,
        preset.accentActive,
        preset.accentSubtle,
        preset.accentFg,
      ]) {
        expect(hueOf(colour)).toBe(preset.hue);
      }
    },
  );

  it('has no duplicate ids', () => {
    expect(new Set(THEME_PRESETS.map((t) => t.id)).size).toBe(THEME_PRESETS.length);
  });

  it('offers the default it names', () => {
    expect(themePreset(DEFAULT_THEME_ID)).toBeDefined();
  });

  it('refuses an id that is not on the list', () => {
    expect(ThemeId.safeParse('hotpink').success).toBe(false);
    expect(ThemeId.safeParse(DEFAULT_THEME_ID).success).toBe(true);
  });
});

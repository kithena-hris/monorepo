import type { CSSProperties } from 'react';

/**
 * Re-pointing the brand ramp at a different hue.
 *
 * `tokens.css` defines eleven `--reach-brand-*` stops and then defines every
 * accent token in terms of them — `--reach-color-accent` is `--reach-brand-600`
 * in the light theme and `--reach-brand-500` in the dark one, the focus ring is
 * `--reach-brand-500`, the subtle wash is `--reach-brand-50`. So the ramp is the
 * single place a brand colour enters the system, and overriding it is the only
 * change that themes *everything* rather than the handful of tokens somebody
 * remembered to list.
 *
 * The alternative — setting `--reach-color-accent` and its six siblings
 * directly — was the previous approach and it is wrong in two ways that only
 * show up later. It leaves the focus ring on the default hue, because
 * `border-focus` is not an accent token. And it cannot be right in both colour
 * schemes at once: the light theme's subtle wash sits at 0.96 lightness and the
 * dark theme's at 0.31, so a single inline value is legible in one and invisible
 * in the other. Overriding the ramp instead lets each scheme keep its own
 * mapping, which is where that knowledge already lives.
 *
 * ## Why only the hue moves
 *
 * The lightness and chroma of each stop are the design system's, unchanged. They
 * are what make a ramp usable — 50 light enough to carry dark text, 600 dark
 * enough to carry white — and they were tuned against the contrast gate that
 * `pnpm test-stories` runs. A caller supplying its own curve could supply one
 * that fails, so a caller does not get to. One number in, a legible ramp out.
 *
 * Chroma is the exception that proves it: hues differ in how much chroma sRGB
 * can actually represent at a given lightness, so a yellow at indigo's chroma
 * would clip. `chromaCeiling` holds each stop to what the gamut allows, which
 * costs saturation on the hues that cannot have it and nothing on the ones that
 * can.
 *
 * This file knows nothing about who is calling or why. It takes an angle.
 */

/**
 * The default ramp's curve, read off `tokens.css`.
 *
 * Duplicated from CSS because there is no way to compute a derived colour from
 * a custom property at author time — `oklch(from var(--x) …)` is relative
 * colour syntax and is not available where this has to run. `brand-ramp.test.ts`
 * parses `tokens.css` and fails when a stop here stops matching, which is the
 * same trade `reach-tokens.json` makes. Exported so that check can compare the
 * copy against the original rather than against this module's output, which has
 * had the gamut clamp applied and is a different question.
 *
 * Note that several of the light stops sit marginally outside sRGB as authored.
 * That is not a mistake in the stylesheet — a browser clips them per channel and
 * the result is the colour the design system ships. `brandRamp` reduces chroma
 * instead, which lands in the same place for the default hue and keeps the hue
 * honest for the ones where the gamut is much narrower.
 */
export const BRAND_CURVE: readonly (readonly [
  stop: number,
  lightness: number,
  chroma: number,
])[] = [
  [50, 0.97, 0.017],
  [100, 0.944, 0.033],
  [200, 0.897, 0.062],
  [300, 0.827, 0.099],
  [400, 0.732, 0.144],
  [500, 0.638, 0.183],
  [600, 0.567, 0.209],
  [700, 0.503, 0.198],
  [800, 0.435, 0.166],
  [900, 0.382, 0.132],
  [950, 0.269, 0.095],
];

/**
 * The most chroma this hue can hold at this lightness and stay in sRGB.
 *
 * Found by bisection rather than by a formula, because the sRGB gamut boundary
 * in oklch has no closed form — it is the image of a cube under a non-linear
 * map, and its shape in the hue-lightness plane is the reason a fixed chroma
 * looks vivid at 264° and clips at 100°.
 *
 * Sixteen steps resolves to under 0.0001, which is finer than the difference
 * between adjacent stops on the curve above.
 */
function chromaCeiling(lightness: number, hue: number, wanted: number): number {
  if (inGamut(lightness, wanted, hue)) return wanted;

  let low = 0;
  let high = wanted;
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut(lightness, mid, hue)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * oklch to linear-light sRGB, then a bounds check.
 *
 * The matrices are the Oklab specification's, the same pair `branding.test.ts`
 * uses to verify contrast. A small tolerance because a channel landing at
 * -1e-9 is a rounding artefact of the matrix multiply, not an out-of-gamut
 * colour, and rejecting it would shave chroma off every stop for nothing.
 */
function inGamut(L: number, C: number, hDeg: number): boolean {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return channels.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
}

/**
 * The eleven brand stops at `hue`, as inline custom properties.
 *
 * ## Apply this to `<html>`, and nowhere else
 *
 * ```tsx
 * <html style={brandRamp(195)}>…</html>
 * ```
 *
 * On a wrapper `<div>` it does almost nothing, and the way it fails is quiet
 * enough to ship. `tokens.css` declares `--reach-color-accent: var(--reach-brand-600)`
 * **on `:root`**, and a `var()` is substituted at the element where the
 * declaration lives — not where the value is finally read. So by the time
 * anything inherits `--reach-color-accent`, it is already the resolved default
 * colour, and re-pointing `--reach-brand-600` further down the tree changes a
 * variable that nothing consults again.
 *
 * The observable symptom is a page where `--reach-brand-600` inherits the new
 * hue correctly and every button, ring and wash stays the old one — which reads
 * as "the theme did not apply" and invites someone to override the accent
 * tokens directly. That is the trap: overriding them works, and then cannot be
 * right in both colour schemes, because the light and dark themes map the ramp
 * to accents differently and an inline value cannot vary.
 *
 * Setting the ramp on the root element keeps that mapping where it already
 * lives. The stylesheet's own `:root` declarations then substitute the new
 * values, `.dark` substitutes its own, and every token follows.
 */
export function brandRamp(hue: number): CSSProperties {
  // A hue is an angle, so the useful reading of 400 is 40 rather than an error.
  // Anything that is not a number at all has no reading and is refused, because
  // the alternative is `oklch(0.97 0.017 NaN)` on every stop and a page with no
  // colour at all.
  if (!Number.isFinite(hue)) return {};
  const angle = ((hue % 360) + 360) % 360;

  // Custom properties are not in `CSSProperties`' index signature, but React
  // passes any `--`-prefixed key straight through to the style attribute.
  const style: CSSProperties = {};
  for (const [stop, lightness, chroma] of BRAND_CURVE) {
    // Floored to four places, not rounded. `toFixed` rounds half away from
    // zero, which can lift a value that was exactly at the gamut boundary back
    // over it — the clamp then reads as having done nothing. Truncating can
    // only ever move further inside.
    const c = Math.floor(chromaCeiling(lightness, angle, chroma) * 1e4) / 1e4;
    Reflect.set(
      style,
      `--reach-brand-${String(stop)}`,
      `oklch(${String(lightness)} ${c.toFixed(4)} ${String(angle)})`,
    );
  }
  return style;
}

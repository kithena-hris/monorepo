import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BRAND_CURVE, brandRamp } from './brand-ramp';

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** The `--reach-brand-*` block of `tokens.css`, parsed rather than restated. */
function rampFromCss(): Map<number, { lightness: number; chroma: number; hue: number }> {
  // From the package root, which is where vitest runs. `import.meta.url` points
  // into the transformed module rather than the source tree here.
  const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  const found = new Map<number, { lightness: number; chroma: number; hue: number }>();

  for (const line of css.split('\n')) {
    const match = /--reach-brand-(\d+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(line);
    if (!match) continue;
    found.set(Number(match[1]), {
      lightness: Number(match[2]),
      chroma: Number(match[3]),
      hue: Number(match[4]),
    });
  }
  return found;
}

function parse(value: string): { lightness: number; chroma: number; hue: number } {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`not an oklch triple: ${value}`);
  return { lightness: Number(match[1]), chroma: Number(match[2]), hue: Number(match[3]) };
}

describe('brandRamp', () => {
  const css = rampFromCss();

  it('covers every stop the stylesheet defines', () => {
    const generated = Object.keys(brandRamp(264));
    expect(generated).toHaveLength(STOPS.length);
    expect(css.size).toBe(STOPS.length);
  });

  /*
   * The drift check. `BRAND_CURVE` is a copy of the stylesheet's lightness and
   * chroma, and a copy nobody verifies is a copy that goes stale — retune the
   * ramp in CSS and a themed tenant would silently keep the old curve while
   * every unthemed surface moved.
   *
   * Against the curve rather than against `brandRamp`'s output, because the
   * output has had the gamut clamp applied and would differ for a reason that
   * has nothing to do with drift.
   */
  it.each(STOPS)('stop %i is copied faithfully from the stylesheet', (stop) => {
    const fromCss = css.get(stop);
    const fromCurve = BRAND_CURVE.find(([s2]) => s2 === stop);
    expect(fromCss).toBeDefined();
    expect(fromCurve).toBeDefined();
    if (!fromCss || !fromCurve) return;

    expect(fromCurve[1]).toBe(fromCss.lightness);
    expect(fromCurve[2]).toBe(fromCss.chroma);
  });

  it('every stylesheet stop is on the one hue the ramp is built from', () => {
    expect(new Set([...css.values()].map((v) => v.hue)).size).toBe(1);
  });

  /*
   * Several light stops are authored marginally outside sRGB, so the clamp bites
   * even at the default hue. What must hold is that it only ever *reduces*
   * chroma and never invents any, and that lightness and hue come through
   * untouched — those two are what make the ramp a ramp.
   */
  it.each(STOPS)('stop %i keeps its lightness and hue, and never gains chroma', (stop) => {
    const fromCurve = BRAND_CURVE.find(([s2]) => s2 === stop);
    if (!fromCurve) throw new Error(`no curve entry for ${String(stop)}`);

    const generated = parse(
      (brandRamp(272) as Record<string, string>)[`--reach-brand-${String(stop)}`] ?? '',
    );
    expect(generated.lightness).toBe(fromCurve[1]);
    expect(generated.hue).toBe(272);
    expect(generated.chroma).toBeLessThanOrEqual(fromCurve[2]);
    // Not so much less that the ramp stops reading as a colour. Every stop the
    // stylesheet asks for is within reach at this hue or close to it.
    expect(generated.chroma).toBeGreaterThan(fromCurve[2] * 0.75);
  });

  it('holds every stop of every hue inside sRGB', () => {
    for (let hue = 0; hue < 360; hue += 5) {
      for (const [name, value] of Object.entries(brandRamp(hue))) {
        const { lightness, chroma } = parse(String(value));
        // Recomputed with the specification matrices rather than trusting the
        // module's own bisection to mark its own work.
        expect(
          inSrgb(lightness, chroma, hue),
          `${name} at hue ${String(hue)} is outside sRGB`,
        ).toBe(true);
      }
    }
  });

  it('wraps an angle rather than refusing it', () => {
    expect(brandRamp(400)).toEqual(brandRamp(40));
    expect(brandRamp(-40)).toEqual(brandRamp(320));
  });

  /*
   * `oklch(0.97 0.017 NaN)` is not a colour, and a page that set eleven of them
   * would lose its accent entirely. Nothing is the safer answer: the element
   * inherits the default ramp and looks unthemed, which is visibly wrong in the
   * right direction.
   */
  it('returns nothing for a hue that is not a number', () => {
    expect(brandRamp(Number.NaN)).toEqual({});
    expect(brandRamp(Number.POSITIVE_INFINITY)).toEqual({});
  });
});

function inSrgb(L: number, C: number, hDeg: number): boolean {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].every((v) => v >= -1e-5 && v <= 1 + 1e-5);
}

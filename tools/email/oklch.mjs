/**
 * OKLCH to sRGB.
 *
 * Reach writes every colour in OKLCH so that a lightness step is a perceptual
 * step. No mail client resolves `oklch()` — Outlook renders through Word, Gmail
 * rewrites what it does not understand, and the ones that do support it are the
 * minority — so the email carries sRGB hex, and this is what produces it.
 *
 * The conversion is Björn Ottosson's, unmodified: OKLCH to OKLab by polar
 * coordinates, OKLab to cone responses, cubed, through the linear-sRGB matrix,
 * then gamma encoded. It is checked against
 * `apps/storybook/.storybook/reach-tokens.json`, which holds the same tokens as
 * a *browser* resolved them — so this is verified against the renderer it is
 * standing in for rather than against itself.
 */

/** `oklch(L C H)` or `oklch(L C H / A)`, as the stylesheet writes it. */
const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/;

export function parseOklch(value) {
  const match = OKLCH.exec(value.trim());
  if (!match) return null;
  return {
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/** Gamma encode one linear channel, then quantise to a byte. */
function encode(channel) {
  const value = channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  // Clamped rather than scaled. A colour outside the sRGB gamut has no
  // faithful hex, and the nearest one on the face of the cube is what every
  // browser does with it too.
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

export function oklchToHex({ l, c, h }) {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const rgb = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];

  return `#${rgb.map((channel) => encode(channel).toString(16).padStart(2, '0')).join('')}`;
}

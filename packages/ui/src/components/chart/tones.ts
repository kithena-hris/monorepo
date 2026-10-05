/**
 * The colour of a mark.
 *
 * Two families. `chart-1` … `chart-6` are the categorical palette: equal
 * lightness and chroma at six hues, so a series means "this one, not that one"
 * and none of them shouts. The status names (`success`, `danger` …) are for a
 * mark whose colour *is* the meaning, a loss in a waterfall or the worst step
 * in a funnel, and they point at the `-fg` end of each ramp (see below).
 */
export type ChartTone =
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

/** The categorical order a multi-series chart hands out when a series names no tone. */
export const seriesTones: readonly ChartTone[] = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
];

export function seriesTone(index: number): ChartTone {
  return seriesTones[index % seriesTones.length] ?? 'chart-1';
}

// Status tones point at the `-fg` end of each ramp, not the base.
//
// A base tone is mixed to sit on its own tinted wash, which is right for a
// badge and wrong for a mark drawn straight onto the card: amber-600 on white
// measures 2.76:1, and a donut slice is a graphical object that WCAG 1.4.11
// asks 3:1 of. `neutral` already points at a foreground token and stays put.
//
// The categorical `chart-N` tones are the palette as the tokens define it.
// Three of them (2, 3 and 6) sit under 3:1 on a white card in the light theme,
// which is why every chart here also prints its values, labels its series in
// text, and carries a data table: the colour tells series apart, it is never
// the only way to read a number. `tools/a11y/contrast-sweep.mjs` measures the
// status tones; the categorical ones are a token decision, not a chart one.
export const fillTone: Record<ChartTone, string> = {
  'chart-1': 'fill-chart-1',
  'chart-2': 'fill-chart-2',
  'chart-3': 'fill-chart-3',
  'chart-4': 'fill-chart-4',
  'chart-5': 'fill-chart-5',
  'chart-6': 'fill-chart-6',
  accent: 'fill-accent-fg',
  success: 'fill-success-fg',
  warning: 'fill-warning-fg',
  danger: 'fill-danger-fg',
  info: 'fill-info-fg',
  neutral: 'fill-fg-subtle',
};

export const strokeTone: Record<ChartTone, string> = {
  'chart-1': 'stroke-chart-1',
  'chart-2': 'stroke-chart-2',
  'chart-3': 'stroke-chart-3',
  'chart-4': 'stroke-chart-4',
  'chart-5': 'stroke-chart-5',
  'chart-6': 'stroke-chart-6',
  accent: 'stroke-accent-fg',
  success: 'stroke-success-fg',
  warning: 'stroke-warning-fg',
  danger: 'stroke-danger-fg',
  info: 'stroke-info-fg',
  neutral: 'stroke-fg-subtle',
};

export const bgTone: Record<ChartTone, string> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  accent: 'bg-accent-fg',
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
  info: 'bg-info-fg',
  neutral: 'bg-fg-subtle',
};

export const borderTone: Record<ChartTone, string> = {
  'chart-1': 'border-chart-1',
  'chart-2': 'border-chart-2',
  'chart-3': 'border-chart-3',
  'chart-4': 'border-chart-4',
  'chart-5': 'border-chart-5',
  'chart-6': 'border-chart-6',
  accent: 'border-accent-fg',
  success: 'border-success-fg',
  warning: 'border-warning-fg',
  danger: 'border-danger-fg',
  info: 'border-info-fg',
  neutral: 'border-fg-subtle',
};

/**
 * The same colours as CSS values, for the places a class cannot reach: a
 * `color-mix()` ramp in a heatmap cell, a gradient in a scale key.
 */
export const toneVar: Record<ChartTone, string> = {
  'chart-1': 'var(--color-chart-1)',
  'chart-2': 'var(--color-chart-2)',
  'chart-3': 'var(--color-chart-3)',
  'chart-4': 'var(--color-chart-4)',
  'chart-5': 'var(--color-chart-5)',
  'chart-6': 'var(--color-chart-6)',
  accent: 'var(--color-accent-fg)',
  success: 'var(--color-success-fg)',
  warning: 'var(--color-warning-fg)',
  danger: 'var(--color-danger-fg)',
  info: 'var(--color-info-fg)',
  neutral: 'var(--color-fg-subtle)',
};

/**
 * A tone at `percent` strength over the sunken fill: one hue, varying only in
 * strength, which is the single channel a heatmap should use.
 *
 * Mixed in Oklab, not Oklch: the neutral surfaces carry a hue of their own
 * (an explicit 0, or the brand's slight tint), and an Oklch mix interpolates
 * the hue towards it, which turned indigo pink half way.
 */
export function toneMix(tone: ChartTone, percent: number): string {
  const clamped = Math.round(Math.min(Math.max(percent, 0), 100));
  return `color-mix(in oklab, ${toneVar[tone]} ${String(clamped)}%, var(--color-surface-sunken))`;
}

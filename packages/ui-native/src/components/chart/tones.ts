/**
 * The colour of a mark, as the web's `ChartTone` names it.
 *
 * Two families. `chart-1` … `chart-6` are the categorical palette: one colour
 * means one series, handed out in this order. The status names are for a mark
 * whose colour *is* the meaning (a loss in a waterfall, the worst step in a
 * funnel) and point at the strong end of each ramp, as the web's do.
 *
 * Every value is a class over the shared tokens, so the phone repaints with
 * the theme exactly as the web does. A mark drawn in SVG takes its colour as
 * `currentColor` from a `text-*` class (see `Ink` in `parts.tsx`); a mark
 * drawn as a view takes a `bg-*` one.
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

/*
 * Status tones are the solid status colour on a phone, as the design paints
 * them (`--r-danger`, not `--r-danger-text`): a mark is a shape, not text,
 * and the label beside it carries the meaning in words.
 */
export const bgTone: Record<ChartTone, string> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
};

/** The same colours as `currentColor`, for SVG. */
export const inkTone: Record<ChartTone, string> = {
  'chart-1': 'text-chart-1',
  'chart-2': 'text-chart-2',
  'chart-3': 'text-chart-3',
  'chart-4': 'text-chart-4',
  'chart-5': 'text-chart-5',
  'chart-6': 'text-chart-6',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-fg-subtle',
};

export const borderTone: Record<ChartTone, string> = {
  'chart-1': 'border-chart-1',
  'chart-2': 'border-chart-2',
  'chart-3': 'border-chart-3',
  'chart-4': 'border-chart-4',
  'chart-5': 'border-chart-5',
  'chart-6': 'border-chart-6',
  accent: 'border-accent',
  success: 'border-success',
  warning: 'border-warning',
  danger: 'border-danger',
  info: 'border-info',
  neutral: 'border-fg-subtle',
};

/** A status tone's tint and its text colour, for a bar with a label inside it. */
export const softTone: Record<ChartTone, { bg: string; text: string }> = {
  'chart-1': { bg: 'bg-accent-subtle', text: 'text-accent-fg' },
  'chart-2': { bg: 'bg-info-subtle', text: 'text-info-fg' },
  'chart-3': { bg: 'bg-warning-subtle', text: 'text-warning-fg' },
  'chart-4': { bg: 'bg-danger-subtle', text: 'text-danger-fg' },
  'chart-5': { bg: 'bg-info-subtle', text: 'text-info-fg' },
  'chart-6': { bg: 'bg-success-subtle', text: 'text-success-fg' },
  accent: { bg: 'bg-accent-subtle', text: 'text-accent-fg' },
  success: { bg: 'bg-success-subtle', text: 'text-success-fg' },
  warning: { bg: 'bg-warning-subtle', text: 'text-warning-fg' },
  danger: { bg: 'bg-danger-subtle', text: 'text-danger-fg' },
  info: { bg: 'bg-info-subtle', text: 'text-info-fg' },
  neutral: { bg: 'bg-surface-sunken', text: 'text-fg-muted' },
};

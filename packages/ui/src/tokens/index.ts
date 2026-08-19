/**
 * Token registry.
 *
 * This file lists token *names*, never their values. The values live in
 * `styles/tokens.css` and are resolved from the DOM at runtime, so the
 * documentation cannot drift from what ships, the same reason a derived
 * artifact is never hand-written anywhere else in this repo.
 */

export const semanticColorTokens = {
  surface: [
    '--reach-color-canvas',
    '--reach-color-surface',
    '--reach-color-surface-sunken',
    '--reach-color-surface-hover',
    '--reach-color-surface-active',
    '--reach-color-overlay',
  ],
  foreground: [
    '--reach-color-fg',
    '--reach-color-fg-muted',
    '--reach-color-fg-subtle',
    '--reach-color-fg-disabled',
    '--reach-color-fg-on-accent',
  ],
  border: ['--reach-color-border', '--reach-color-border-strong', '--reach-color-border-focus'],
  accent: [
    '--reach-color-accent',
    '--reach-color-accent-hover',
    '--reach-color-accent-active',
    '--reach-color-accent-subtle',
    '--reach-color-accent-subtle-hover',
    '--reach-color-accent-fg',
  ],
  success: [
    '--reach-color-success',
    '--reach-color-success-subtle',
    '--reach-color-success-border',
    '--reach-color-success-fg',
  ],
  warning: [
    '--reach-color-warning',
    '--reach-color-warning-subtle',
    '--reach-color-warning-border',
    '--reach-color-warning-fg',
  ],
  danger: [
    '--reach-color-danger',
    '--reach-color-danger-hover',
    '--reach-color-danger-subtle',
    '--reach-color-danger-border',
    '--reach-color-danger-fg',
  ],
  info: [
    '--reach-color-info',
    '--reach-color-info-subtle',
    '--reach-color-info-border',
    '--reach-color-info-fg',
  ],
} as const satisfies Record<string, readonly string[]>;

export const primitiveColorScales = {
  neutral: [
    '--reach-neutral-0',
    '--reach-neutral-50',
    '--reach-neutral-100',
    '--reach-neutral-200',
    '--reach-neutral-300',
    '--reach-neutral-400',
    '--reach-neutral-500',
    '--reach-neutral-600',
    '--reach-neutral-700',
    '--reach-neutral-800',
    '--reach-neutral-900',
    '--reach-neutral-950',
  ],
  brand: [
    '--reach-brand-50',
    '--reach-brand-100',
    '--reach-brand-200',
    '--reach-brand-300',
    '--reach-brand-400',
    '--reach-brand-500',
    '--reach-brand-600',
    '--reach-brand-700',
    '--reach-brand-800',
    '--reach-brand-900',
    '--reach-brand-950',
  ],
} as const satisfies Record<string, readonly string[]>;

export const elevationTokens = [
  '--reach-shadow-xs',
  '--reach-shadow-sm',
  '--reach-shadow-md',
  '--reach-shadow-lg',
  '--reach-shadow-xl',
] as const;

export const typeScale = ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl'] as const;

export const radiusScale = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

export const motionDurations = [
  '--animate-duration-instant',
  '--animate-duration-fast',
  '--animate-duration-normal',
  '--animate-duration-slow',
] as const;

export const motionEasings = ['--ease-standard', '--ease-entrance', '--ease-exit'] as const;

/**
 * Spring easings, and the duration each was solved for.
 *
 * Listed as pairs rather than folded into the two arrays above because they are
 * not independent: a `linear()` curve baked from a spring is only correct at the
 * settle time it was baked for, so picking one of these means picking both.
 */
export const motionSprings = [
  { easing: '--ease-spring-snap', duration: '--animate-duration-spring-snap' },
  { easing: '--ease-spring-move', duration: '--animate-duration-spring-move' },
  { easing: '--ease-spring-drawer', duration: '--animate-duration-spring-drawer' },
  { easing: '--ease-spring-flick', duration: '--animate-duration-spring-flick' },
] as const;

/** Reads a token's computed value from the live document. */
export function resolveToken(name: string, element: Element | null = null): string {
  const target = element ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return '';
  return getComputedStyle(target).getPropertyValue(name).trim();
}

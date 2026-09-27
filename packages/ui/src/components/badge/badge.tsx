import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { icons } from '../../icons';
import { cn } from '../../lib/cn';

const badge = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-sunken text-fg-muted',
        accent: 'border-transparent bg-accent-subtle text-accent-fg',
        success: 'border-success-border bg-success-subtle text-success-fg',
        warning: 'border-warning-border bg-warning-subtle text-warning-fg',
        danger: 'border-danger-border bg-danger-subtle text-danger-fg',
        info: 'border-info-border bg-info-subtle text-info-fg',
        // Not a status but a property of what is marked: outlined rather than
        // washed, and always with its glyph, so it reads apart from a state.
        sensitive: 'border-border-strong bg-surface text-fg',
        // Something that should be there and is not. The warning wash, but
        // dashed and with its own glyph, so it reads as "fill this in" rather
        // than as a status somebody set — and never as colour alone.
        attention: 'border-dashed border-warning-border bg-warning-subtle text-warning-fg',
      },
      size: {
        sm: 'h-5 px-2 text-2xs',
        md: 'h-6 px-2.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps extends ComponentPropsWithoutRef<'span'>, VariantProps<typeof badge> {
  /**
   * Renders a filled dot in the tone colour. Use it when the badge sits in a
   * dense table where the wash alone is easy to miss.
   */
  dot?: boolean;
  /**
   * Makes the badge a removable chip: an active filter, a chosen tag. The
   * button is a real one with its own name, because "×" read aloud is
   * "times", and a chip whose only exit is a pointer is a trap.
   */
  onRemove?: () => void;
  /** Names the remove button. Defaults to "Remove" and the badge's text when it is a string. */
  removeLabel?: string;
}

/**
 * Status marker.
 *
 * The tone is never the only signal, the label carries the meaning, because
 * roughly one in twelve men cannot separate the success and danger washes.
 * `tone="sensitive"` marks what is handled with more care than most — a
 * value whose change waits for somebody else — and brings its own glyph.
 * `tone="attention"` marks what is missing and wanted — a field nobody has
 * filled in — and brings its own glyph too: `<Badge tone="attention">Missing</Badge>`.
 */
export function Badge({
  className,
  tone,
  size,
  dot = false,
  onRemove,
  removeLabel,
  children,
  ...props
}: BadgeProps): JSX.Element {
  return (
    <span className={cn(badge({ tone, size }), onRemove && 'pe-0.5', className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {tone === 'sensitive' ? <icons.sensitive aria-hidden="true" /> : null}
      {tone === 'attention' ? <icons.missing aria-hidden="true" /> : null}
      {children}
      {onRemove === undefined ? null : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={
            removeLabel ?? (typeof children === 'string' ? `Remove ${children}` : 'Remove')
          }
          className={cn(
            'tap-target relative -me-0.5 grid size-4 cursor-pointer place-items-center rounded-full',
            'transition-colors duration-(--animate-duration-fast) hover:bg-current/15',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
          )}
        >
          <icons.close aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

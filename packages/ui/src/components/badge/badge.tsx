import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { icons } from '../../icons';
import { cn } from '../../lib/cn';

const badge = cva(
  'inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: '',
        accent: '',
        success: '',
        warning: '',
        danger: '',
        info: '',
        // Not a status but a property of what is marked: outlined rather than
        // washed, and always with its glyph, so it reads apart from a state.
        sensitive: 'bg-surface text-fg shadow-[inset_0_0_0_1px_var(--reach-color-border-strong)]',
      },
      /**
       * `soft` is the wash, for a status among other content. `solid` is the
       * fill, for the one badge that has to be seen first — a count, "Overdue".
       * `outline` is a property rather than a state, and takes no tone colour.
       */
      variant: {
        soft: '',
        solid: '',
        outline:
          'bg-transparent text-fg-muted shadow-[inset_0_0_0_1px_var(--reach-color-border-strong)]',
      },
      size: {
        /** A count pinned to a control: a 16px circle that widens with the digits. */
        xs: 'h-4 min-w-4 justify-center gap-1 px-1 text-2xs leading-none font-bold tabular-nums',
        sm: 'h-5 px-2 text-[0.75rem] touch:h-[1.375rem]',
        md: 'h-6 px-2.5 text-[0.8125rem] touch:h-[1.625rem]',
        lg: 'h-7 px-3 text-[0.8125rem] touch:h-[1.875rem]',
      },
    },
    compoundVariants: [
      { variant: 'soft', tone: 'neutral', class: 'bg-surface-sunken text-fg-muted' },
      { variant: 'soft', tone: 'accent', class: 'bg-accent-subtle text-accent-fg' },
      { variant: 'soft', tone: 'success', class: 'bg-success-subtle text-success-fg' },
      { variant: 'soft', tone: 'warning', class: 'bg-warning-subtle text-warning-fg' },
      { variant: 'soft', tone: 'danger', class: 'bg-danger-subtle text-danger-fg' },
      { variant: 'soft', tone: 'info', class: 'bg-info-subtle text-info-fg' },
      // Solid fills pair each colour with a text colour that holds 4.5:1 in both
      // themes. Warning and info have no dark-enough fill for white text, so
      // they use their text colour as the fill and the surface as the text —
      // a light pill on a dark page, a dark one on a light page.
      { variant: 'solid', tone: 'neutral', class: 'bg-invert text-fg-on-invert' },
      { variant: 'solid', tone: 'accent', class: 'bg-accent-solid text-fg-on-accent' },
      { variant: 'solid', tone: 'success', class: 'bg-success-solid text-fg-on-solid' },
      { variant: 'solid', tone: 'warning', class: 'bg-warning-fg text-surface' },
      { variant: 'solid', tone: 'danger', class: 'bg-danger-solid text-fg-on-solid' },
      { variant: 'solid', tone: 'info', class: 'bg-info-fg text-surface' },
    ],
    defaultVariants: { tone: 'neutral', variant: 'soft', size: 'md' },
  },
);

/** The dot is the tone's own colour on a wash, and the text colour on a fill. */
const dotTone = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  sensitive: 'bg-current',
} as const;

export interface BadgeProps extends ComponentPropsWithoutRef<'span'>, VariantProps<typeof badge> {
  /**
   * Renders a filled dot in the tone colour. Use it when the badge sits in a
   * dense table where the wash alone is easy to miss.
   */
  dot?: boolean;
  /**
   * Adds a remove control at the end, making the badge a chip: an applied
   * filter, a chosen team. The badge stays a label; only the control is a
   * button, so the label is not announced as something to press.
   */
  onRemove?: () => void;
  /** Accessible name of the remove control. Name what goes: "Remove Berlin". */
  removeLabel?: string;
}

/**
 * Status marker.
 *
 * The tone is never the only signal, the label carries the meaning, because
 * roughly one in twelve men cannot separate the success and danger washes.
 * `tone="sensitive"` marks what is handled with more care than most — a
 * value whose change waits for somebody else — and brings its own glyph.
 */
export function Badge({
  className,
  tone,
  variant,
  size,
  dot = false,
  onRemove,
  removeLabel = 'Remove',
  children,
  ...props
}: BadgeProps): JSX.Element {
  return (
    <span className={cn(badge({ tone, variant, size }), onRemove && 'pe-1', className)} {...props}>
      {dot ? (
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            variant === 'soft' || variant == null ? dotTone[tone ?? 'neutral'] : 'bg-current',
          )}
          aria-hidden="true"
        />
      ) : null}
      {tone === 'sensitive' ? <icons.sensitive aria-hidden="true" /> : null}
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className={cn(
            'relative grid size-4 shrink-0 place-items-center rounded-full tap-target touch:size-5',
            'bg-[color-mix(in_oklch,currentColor_12%,transparent)] transition-colors',
            'hover:bg-[color-mix(in_oklch,currentColor_22%,transparent)]',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
            '[&_svg]:size-3!',
          )}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

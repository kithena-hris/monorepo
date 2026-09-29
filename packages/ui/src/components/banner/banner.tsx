import { cva, type VariantProps } from 'class-variance-authority';
import {
  CircleAlert,
  CircleCheck,
  Info,
  Megaphone,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A message about the whole app or account, across the top of the page.
 *
 * Not an `Alert`, which sits beside the one section it is about, and not a
 * toast, which confirms something you just did and leaves on its own. A banner
 * stays until the thing it reports is fixed or somebody dismisses it, and only
 * one shows at a time: the most severe first, the rest paged behind it.
 *
 * Links inside the message are underlined in the banner's own colour, so an
 * action reads on every tone, including the solid and inverted ones where the
 * accent colour would not.
 */

const banner = cva(
  [
    'flex items-center gap-3 px-5 py-2.5 text-sm/[1.45]',
    // Under a finger the actions drop onto their own row, under the text they
    // belong to, instead of squeezing it into a column of three words.
    'touch:flex-wrap touch:items-start touch:px-4 touch:py-3',
    '[&_a]:font-semibold [&_a]:whitespace-nowrap [&_a]:text-current [&_a]:underline [&_a]:underline-offset-3',
    '[&_a]:relative [&_a]:tap-target',
  ],
  {
    variants: {
      tone: {
        info: '',
        success: '',
        warning: '',
        danger: '',
        accent: '',
        neutral: '',
      },
      emphasis: {
        soft: 'text-fg',
        // A solid fill exists for the tones with an AA pair; the others fall
        // back to the inverted surface rather than to a fill that fails.
        // On a fill, the focus ring takes the ink the fill is drawn for; an
        // accent ring would vanish against an accent or inverted banner.
        solid:
          'bg-invert text-fg-on-invert [--reach-color-border-focus:var(--reach-color-fg-on-invert)]',
        invert:
          'bg-invert text-fg-on-invert [--reach-color-border-focus:var(--reach-color-fg-on-invert)]',
      },
      rounded: { true: 'rounded-md touch:rounded-[1.125rem]', false: '' },
    },
    compoundVariants: [
      { emphasis: 'soft', tone: 'info', class: 'bg-info-subtle' },
      { emphasis: 'soft', tone: 'success', class: 'bg-success-subtle' },
      { emphasis: 'soft', tone: 'warning', class: 'bg-warning-subtle' },
      { emphasis: 'soft', tone: 'danger', class: 'bg-danger-subtle' },
      { emphasis: 'soft', tone: 'accent', class: 'bg-accent-subtle' },
      { emphasis: 'soft', tone: 'neutral', class: 'bg-surface-sunken' },
      {
        emphasis: 'solid',
        tone: 'danger',
        class:
          'bg-danger-solid text-fg-on-solid [--reach-color-border-focus:var(--reach-color-fg-on-solid)]',
      },
      {
        emphasis: 'solid',
        tone: 'success',
        class:
          'bg-success-solid text-fg-on-solid [--reach-color-border-focus:var(--reach-color-fg-on-solid)]',
      },
      {
        emphasis: 'solid',
        tone: 'accent',
        class:
          'bg-accent-solid text-fg-on-accent [--reach-color-border-focus:var(--reach-color-fg-on-solid)]',
      },
    ],
    defaultVariants: { tone: 'info', emphasis: 'soft', rounded: false },
  },
);

const iconTone = {
  info: 'text-info-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  accent: 'text-accent-fg',
  neutral: 'text-fg-muted',
} as const;

const defaultIcon = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  accent: Sparkles,
  neutral: Megaphone,
} as const;

export interface BannerProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'title'>, VariantProps<typeof banner> {
  /** Bold lead-in, read first: "Payroll closes tomorrow at 17:00." */
  title?: ReactNode;
  /** Replaces the tone's icon. `false` hides it. */
  icon?: ReactNode;
  /** Buttons or links, after the message. They wrap onto their own row under a finger. */
  actions?: ReactNode;
  /** Shows a close button. Leave it out for a banner that must stay until fixed. */
  onDismiss?: () => void;
  dismissLabel?: string;
}

export function Banner({
  className,
  tone,
  emphasis,
  rounded,
  title,
  icon,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  children,
  ...props
}: BannerProps): JSX.Element {
  const resolvedTone = tone ?? 'info';
  const Icon = defaultIcon[resolvedTone];
  const soft = (emphasis ?? 'soft') === 'soft';
  // Danger and warning interrupt; the rest wait for a pause. A banner on page
  // load that shouts every visit trains people to ignore the next one.
  const urgent = resolvedTone === 'danger' || resolvedTone === 'warning';

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn(banner({ tone, emphasis, rounded }), className)}
      {...props}
    >
      {icon === false ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'flex shrink-0 [&_svg]:size-4.5 touch:pt-px',
            soft ? iconTone[resolvedTone] : 'text-current',
          )}
        >
          {icon ?? <Icon />}
        </span>
      )}
      <p className="min-w-0 flex-[1_1_12.5rem] text-pretty">
        {title ? <span className="font-semibold">{title} </span> : null}
        {children}
      </p>
      {actions ? (
        // Last under a finger, so the close button stays on the first row with
        // the message and the actions take the row below.
        <div className="flex shrink-0 items-center gap-2 touch:order-last touch:w-full touch:ps-7.5">
          {actions}
        </div>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className={cn(
            'relative grid size-7 shrink-0 place-items-center rounded-full tap-target touch:-my-1',
            soft
              ? 'text-fg-muted hover:bg-surface-hover hover:text-fg'
              : 'text-current hover:bg-[color-mix(in_oklch,currentColor_14%,transparent)]',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
            '[&_svg]:size-4',
          )}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

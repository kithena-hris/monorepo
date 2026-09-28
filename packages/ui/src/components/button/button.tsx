'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Spinner } from '../spinner/spinner';

const button = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    // A pill. The radius is a token rather than `rounded-full`, so a theme that
    // wants squarer controls changes one value rather than every button.
    'rounded-control',
    // A small button keeps its size and still takes a whole thumb.
    'tap-target',
    'font-semibold select-none',
    'transition-[background-color,border-color,color,box-shadow,transform]',
    'duration-(--animate-duration-fast) ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    'active:scale-[0.97] motion-reduce:active:scale-100',
    // Disabled is a grey fill with grey text rather than a faded variant: a
    // translucent red button still reads as "danger, press me". A loading
    // button is disabled too, but keeps its colour: it is busy, not refused.
    'disabled:pointer-events-none',
    'not-data-loading:disabled:bg-surface-sunken not-data-loading:disabled:text-fg-disabled',
    // Icons inherit the label's optical weight rather than carrying their own.
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    // A shortcut hint rides in the pill as a translucent keycap, and goes
    // under a finger, where there is no keyboard to press it on.
    '[&_kbd]:bg-[color-mix(in_oklch,currentColor_14%,transparent)] [&_kbd]:shadow-none touch:[&_kbd]:hidden',
    // With no icon to stand in for, everything but the spinner fades and keeps
    // its box, so the button cannot resize mid-submit and move the target
    // under the cursor.
    '[&[data-loading=overlay]>*:not([data-slot=button-spinner])]:opacity-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent-solid text-fg-on-accent hover:bg-accent-hover active:bg-accent-active',
        /** A fill, not a border. The everyday default. */
        secondary: 'bg-surface-sunken text-fg hover:bg-surface-hover active:bg-surface-active',
        /** Accent-washed: a promoted secondary that must not outrank the primary. */
        tinted: 'bg-accent-subtle text-accent-fg hover:bg-accent-subtle-hover',
        /** The earlier name for `tinted`, kept so existing screens keep working. */
        subtle: 'bg-accent-subtle text-accent-fg hover:bg-accent-subtle-hover',
        outline: [
          'bg-transparent text-fg shadow-[inset_0_0_0_1.5px_var(--reach-color-border-strong)]',
          'hover:bg-surface-sunken active:bg-surface-hover not-data-loading:disabled:bg-transparent',
        ],
        ghost:
          'bg-transparent text-fg hover:bg-surface-sunken active:bg-surface-hover not-data-loading:disabled:bg-transparent',
        danger: 'bg-danger-solid text-fg-on-solid hover:bg-danger-hover',
        /** The earlier name for `danger`. */
        destructive: 'bg-danger-solid text-fg-on-solid hover:bg-danger-hover',
        /** A quieter destructive, for "Remove" in a list where solid red would shout. */
        'danger-soft': [
          'bg-danger-subtle text-danger-fg',
          'hover:bg-[color-mix(in_oklch,var(--reach-color-danger-subtle),var(--reach-color-danger)_12%)]',
        ],
        /** Most contrast, for the one action on a tinted or busy surface. */
        invert: 'bg-invert text-fg-on-invert hover:opacity-90',
        link: 'bg-transparent text-accent-fg underline underline-offset-3 hover:decoration-2 active:scale-100 not-data-loading:disabled:bg-transparent',
      },
      // 28/32/40/48 at a desk, 32/36/52/56 under a finger. The two larger steps
      // are the shared control scale, so a button lines up with an input on the
      // same row. The two smaller stay small under touch for dense rows, and
      // `tap-target` grows the part a finger can hit instead.
      size: {
        xs: 'h-7 px-3 text-sm touch:h-8 touch:px-3.5 [&_svg]:size-4 touch:[&_svg]:size-[1.125rem]',
        sm: 'h-8 px-3.5 text-sm touch:h-9 touch:px-4 [&_svg]:size-4 touch:[&_svg]:size-[1.125rem]',
        md: 'h-control-md px-4 text-base touch:px-5.5 [&_svg]:size-[1.125rem] touch:[&_svg]:size-5',
        lg: 'h-control-lg px-5 text-[1rem] touch:px-6 touch:text-md [&_svg]:size-[1.1875rem] touch:[&_svg]:size-5',
      },
      iconOnly: {
        true: 'px-0 aspect-square touch:px-0',
        false: '',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      {
        variant: 'link',
        size: ['xs', 'sm', 'md', 'lg'],
        class: 'h-auto px-0 touch:h-auto touch:px-0',
      },
    ],
    defaultVariants: { variant: 'secondary', size: 'md', iconOnly: false, fullWidth: false },
  },
);

export type ButtonVariants = VariantProps<typeof button>;

export interface ButtonProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'color'>, Omit<ButtonVariants, 'iconOnly'> {
  /**
   * Render the child element instead of a `<button>`, forwarding all styling
   * and behaviour onto it. The escape hatch for "a link that looks like a
   * button", which must stay an `<a>`, because a button does not navigate.
   */
  asChild?: boolean;
  /**
   * Shows a spinner and blocks interaction without greying the button out.
   * With a `startIcon` the spinner takes the icon's place and the label stays
   * readable; without one the label stays mounted at zero opacity. Either way
   * the button does not resize mid-submit and move the target out from under
   * the user.
   */
  loading?: boolean;
  /** Announced to assistive tech while `loading` is true. */
  loadingLabel?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

/**
 * The primary action control.
 *
 * Exactly one primary button per view. If a screen has two, one of them is
 * really a secondary action and the hierarchy is lying to the user.
 */
export function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  loading = false,
  loadingLabel = 'Loading',
  startIcon,
  endIcon,
  disabled,
  children,
  type,
  ...props
}: ButtonProps): JSX.Element {
  const Comp = asChild ? Slot : 'button';
  const iconOnly = !children && Boolean(startIcon ?? endIcon);
  // With a leading icon the spinner takes the icon's place and the label
  // stays readable; without one it covers the label, which keeps its width.
  const inline = loading && startIcon != null && !iconOnly;
  const spinner = (
    <Spinner size={size === 'lg' || size === 'md' ? 'md' : 'sm'} label={loadingLabel} />
  );

  return (
    <Comp
      // An unspecified `type` inside a form defaults to `submit`, which is how
      // a "Cancel" button ends up submitting the form.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(button({ variant, size, iconOnly, fullWidth }), className)}
      disabled={asChild ? undefined : (disabled ?? loading)}
      data-loading={loading ? (inline ? 'inline' : 'overlay') : undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !inline ? (
        <span data-slot="button-spinner" className="absolute inset-0 grid place-items-center">
          {spinner}
        </span>
      ) : null}
      {inline ? spinner : startIcon}
      {/* A bare text label is a text node, which the fade rule above cannot
          select, so under the overlay spinner it gets a box of its own. */}
      {loading && !inline && !asChild && children != null ? (
        <span>{children}</span>
      ) : (
        <Slottable>{children}</Slottable>
      )}
      {endIcon}
    </Comp>
  );
}

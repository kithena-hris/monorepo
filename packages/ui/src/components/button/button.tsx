'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Spinner } from '../spinner/spinner';

const button = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    'font-medium select-none',
    'transition-[background-color,border-color,color,box-shadow,transform]',
    'duration-(--animate-duration-fast) ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    'active:scale-[0.985]',
    'disabled:pointer-events-none disabled:opacity-55',
    // Icons inherit the label's optical weight rather than carrying their own.
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    // While loading, everything except the spinner fades but keeps its box, so
    // the button cannot resize mid-submit and move the target under the cursor.
    '[&[data-loading]>*:not([data-slot=button-spinner])]:opacity-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-accent-solid text-fg-on-accent shadow-xs hover:bg-accent-hover active:bg-accent-active',
        secondary:
          'bg-surface text-fg border border-border shadow-xs hover:bg-surface-hover active:bg-surface-active',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-active',
        subtle: 'bg-accent-subtle text-accent-fg hover:bg-accent-subtle-hover',
        destructive: 'bg-danger-solid text-fg-on-accent shadow-xs hover:bg-danger-hover',
        link: 'text-accent-fg underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-control-sm rounded-sm px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-control-md rounded-md px-3.5 text-base [&_svg]:size-4',
        lg: 'h-control-lg rounded-md px-5 text-md [&_svg]:size-[1.125rem]',
      },
      iconOnly: {
        true: 'px-0 aspect-square',
        false: '',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [{ variant: 'link', size: ['sm', 'md', 'lg'], class: 'h-auto px-0' }],
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
   * Shows a spinner and blocks interaction. The label stays mounted at zero
   * opacity so the button does not resize mid-submit and move the pointer
   * target out from under the user.
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

  return (
    <Comp
      // An unspecified `type` inside a form defaults to `submit`, which is how
      // a "Cancel" button ends up submitting the form.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(button({ variant, size, iconOnly, fullWidth }), className)}
      disabled={asChild ? undefined : (disabled ?? loading)}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span data-slot="button-spinner" className="absolute inset-0 grid place-items-center">
          <Spinner size={size === 'lg' ? 'md' : 'sm'} label={loadingLabel} />
        </span>
      ) : null}
      {startIcon}
      <Slottable>{children}</Slottable>
      {endIcon}
    </Comp>
  );
}

'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { useState, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';

/**
 * The one action a screen exists for, floating above its content.
 *
 * One per screen, and never destructive: a thumb lands on it without looking,
 * which is the reason it floats and the reason it must never delete anything.
 *
 * It is a plain button and does not position itself. The page decides where it
 * floats (`fixed bottom-6 end-6` at a desk, above the tab bar on a phone),
 * because only the page knows what else is pinned to that corner.
 *
 * `collapsed` folds an extended button back to its icon, for "shrinks as you
 * scroll". The label stays the accessible name while it is folded, so the
 * button never goes nameless, and the width follows from padding rather than a
 * fixed size so the fold can animate.
 */

const fab = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full shadow-lg',
    'font-semibold select-none tap-target',
    'transition-[background-color,padding,gap,transform,box-shadow] duration-(--animate-duration-normal) ease-standard',
    'active:scale-[0.96] motion-reduce:active:scale-100',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    'disabled:pointer-events-none disabled:opacity-55',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent-solid text-fg-on-accent hover:bg-accent-hover active:bg-accent-active',
        tinted: 'bg-accent-subtle text-accent-fg hover:bg-accent-subtle-hover',
        surface: 'bg-surface-raised text-accent-fg hover:bg-surface-hover',
        invert: 'bg-invert text-fg-on-invert hover:opacity-90',
      },
      // The collapsed padding is (size − icon) / 2, so padding plus icon lands
      // on the size exactly: 40, 56, 96.
      size: {
        sm: 'h-10 px-[11px] text-sm [&_svg]:size-4.5',
        md: 'h-14 px-4 text-md [&_svg]:size-6',
        lg: 'h-24 px-[30px] text-md [&_svg]:size-9',
      },
      shape: { circle: '', rounded: '' },
      extended: { true: 'gap-2.5', false: 'gap-0' },
    },
    compoundVariants: [
      { size: 'sm', extended: true, class: 'ps-3 pe-4' },
      { size: 'md', extended: true, class: 'ps-4.5 pe-5.5' },
      { size: 'lg', extended: true, class: 'ps-7 pe-8' },
      { size: 'sm', shape: 'rounded', class: 'rounded-[0.75rem]' },
      { size: 'md', shape: 'rounded', class: 'rounded-[1.0625rem]' },
      { size: 'lg', shape: 'rounded', class: 'rounded-[1.8rem]' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', shape: 'circle', extended: false },
  },
);

export interface FloatingButtonProps
  extends ComponentPropsWithoutRef<'button'>, Omit<VariantProps<typeof fab>, 'extended'> {
  /** The glyph. Always present, it is what remains when the button folds. */
  icon: ReactNode;
  /**
   * Makes this an extended button. Without it the button is icon-only and
   * needs an `aria-label`.
   */
  label?: ReactNode;
  /** Folds an extended button to its icon. The label remains its name. */
  collapsed?: boolean;
}

export function FloatingButton({
  className,
  variant,
  size,
  shape,
  icon,
  label,
  collapsed = false,
  type,
  ...props
}: FloatingButtonProps): JSX.Element {
  const extended = Boolean(label) && !collapsed;
  return (
    <button
      type={type ?? 'button'}
      data-collapsed={(Boolean(label) && collapsed) || undefined}
      className={cn(fab({ variant, size, shape, extended }), className)}
      {...props}
    >
      {icon}
      {label ? (
        <span
          className={cn(
            'overflow-hidden transition-[max-width,opacity] duration-(--animate-duration-normal) ease-standard',
            collapsed ? 'max-w-0 opacity-0' : 'max-w-64 opacity-100',
          )}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}

export interface SpeedDialAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export interface SpeedDialProps extends Omit<
  FloatingButtonProps,
  'icon' | 'label' | 'collapsed' | 'onClick'
> {
  /** The glyph at rest. It turns into a close cross while the dial is open. */
  icon: ReactNode;
  /** Names the button: "Quick actions". */
  'aria-label': string;
  /** Three at most. More than that is a menu, not a dial. */
  actions: readonly SpeedDialAction[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A floating button that fans out a few related actions above itself.
 *
 * The scrim is the part people miss when they build one: it dims the page, so
 * the three actions read as the only thing on screen, and a tap anywhere on it
 * closes the dial, which is the gesture a thumb already tries. It is drawn
 * under the button, so the cross that closes it stays lit.
 *
 * Behaviour is a Radix popover: focus moves to the first action on open,
 * Escape and a tap outside close it, and focus returns to the button. Each
 * action closes the dial as it runs. The button needs a positioning context
 * of the page's choosing (`fixed` or `absolute`), like `FloatingButton`.
 */
export function SpeedDial({
  icon,
  actions,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  ...props
}: SpeedDialProps): JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean): void => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <FloatingButton
          {...props}
          icon={open ? <X aria-hidden="true" /> : icon}
          className={cn('data-[state=open]:z-50', className)}
        />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={usePortalContainer()}>
        <div className="contents">
          <div aria-hidden className="fixed inset-0 z-40 bg-overlay motion-safe:animate-fade-in" />
          <PopoverPrimitive.Content
            side="top"
            align="end"
            sideOffset={12}
            collisionPadding={12}
            className={cn(
              'z-50 flex flex-col items-end gap-3 outline-none',
              'origin-(--radix-popover-content-transform-origin)',
              'popover-motion',
            )}
          >
            {actions.map((action) => (
              <PopoverPrimitive.Close key={action.label} asChild>
                <button
                  type="button"
                  onClick={action.onSelect}
                  className={cn(
                    'group/dial relative flex items-center gap-3 rounded-full tap-target',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                  )}
                >
                  <span className="rounded-[0.625rem] bg-surface-raised px-3 py-2 text-sm font-semibold text-fg shadow-md">
                    {action.label}
                  </span>
                  <span
                    className={cn(
                      fab({ variant: 'surface', size: 'sm' }),
                      'group-hover/dial:bg-surface-hover',
                    )}
                  >
                    {action.icon}
                  </span>
                </button>
              </PopoverPrimitive.Close>
            ))}
          </PopoverPrimitive.Content>
        </div>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

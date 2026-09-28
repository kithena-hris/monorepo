'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { createContext, use, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';
import { useCoarsePointer } from '../../lib/use-media-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';

/**
 * A short list of actions, as the device expects them.
 *
 * Under a finger it is an iOS action sheet: two cards that rise from the
 * bottom edge, the actions in one and Cancel apart in the other, where the
 * thumb already is. At a desk the same parts render as a `DropdownMenu`
 * anchored to the trigger, because a sheet sliding up from the bottom of a
 * 27-inch monitor puts the actions a long way from the button that asked for
 * them.
 *
 * The switch is the pointer, not the width, as everywhere in Reach: the page
 * says so with `(pointer: coarse)`, or a subtree says so with
 * `data-pointer="coarse"` on the element overlays mount into.
 *
 * The sheet is a Radix dialog, the primitive under `Sheet`: focus moves in and
 * is trapped, Escape and a tap on the scrim close it, and focus returns to the
 * trigger. Each action closes the sheet after it runs.
 */

const SheetModeContext = createContext(false);

/** Whether overlays here mount under a finger. */
function useSheetMode(): boolean {
  const container = usePortalContainer();
  const coarse = useCoarsePointer();
  return coarse || container?.closest('[data-pointer="coarse"]') != null;
}

export interface ActionSheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export function ActionSheet({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: ActionSheetProps): JSX.Element {
  const sheet = useSheetMode();
  // Only the props that were passed, so an uncontrolled sheet stays
  // uncontrolled rather than being handed `open: undefined`.
  const state = {
    ...(open === undefined ? {} : { open }),
    ...(defaultOpen === undefined ? {} : { defaultOpen }),
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
  };
  return (
    <SheetModeContext value={sheet}>
      {sheet ? (
        <DialogPrimitive.Root {...state}>{children}</DialogPrimitive.Root>
      ) : (
        <DropdownMenu {...state}>{children}</DropdownMenu>
      )}
    </SheetModeContext>
  );
}

export function ActionSheetTrigger(
  props: ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>,
): JSX.Element {
  return use(SheetModeContext) ? (
    <DialogPrimitive.Trigger {...props} />
  ) : (
    <DropdownMenuTrigger {...props} />
  );
}

export interface ActionSheetContentProps {
  /**
   * What the actions act on: "Vacation · 14–18 Oct". Also the sheet's
   * accessible name; without it the name is `label`.
   */
  title?: ReactNode;
  /** A consequence worth reading first: "Deleting can’t be undone." */
  description?: ReactNode;
  /** Names the sheet when there is no visible title. */
  label?: string;
  /**
   * Content above the actions, such as the people to share with. Reached by
   * pointer and touch; anything that must also be reachable from the keyboard
   * in the desk menu belongs in an item.
   */
  header?: ReactNode;
  cancelLabel?: string;
  className?: string;
  children?: ReactNode;
}

const action = cn(
  'flex h-14 w-full items-center justify-center gap-2 px-4 text-[1.125rem] text-accent-fg',
  'transition-colors duration-(--animate-duration-fast) active:bg-surface-active',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
  'disabled:text-fg-disabled [&_svg]:size-4.5',
);

const card = 'overflow-hidden rounded-[1.125rem] bg-surface-raised shadow-lg';

export function ActionSheetContent({
  title,
  description,
  label = 'Actions',
  header,
  cancelLabel = 'Cancel',
  className,
  children,
}: ActionSheetContentProps): JSX.Element {
  const sheet = use(SheetModeContext);
  const container = usePortalContainer();

  if (!sheet) {
    return (
      <DropdownMenuContent align="end" aria-label={title ? undefined : label} className={className}>
        {title ? (
          <DropdownMenuLabel>
            {title}
            {description ? (
              <span className="block font-normal text-fg-muted">{description}</span>
            ) : null}
          </DropdownMenuLabel>
        ) : null}
        {header}
        {children}
      </DropdownMenuContent>
    );
  }

  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay
        data-material="scrim"
        className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
      />
      <DialogPrimitive.Content
        // Radix warns about a dialog with no description unless told there is none.
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed inset-x-2 bottom-2 z-50 flex flex-col gap-2 pb-safe-bottom',
          'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
          'focus-visible:outline-none',
          className,
        )}
      >
        <div className={card}>
          {title ? (
            <div className="px-4 py-3.5 text-center shadow-[inset_0_-1px_0_var(--color-border)]">
              <DialogPrimitive.Title className="text-[0.8125rem] font-semibold text-fg-muted">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-[0.8125rem] text-fg-subtle">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
          ) : (
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          )}
          {header}
          <div className="flex flex-col [&>*:not(:last-child)]:shadow-[inset_0_-1px_0_var(--color-border)]">
            {children}
          </div>
        </div>
        <DialogPrimitive.Close className={cn(card, action, 'font-semibold')}>
          {cancelLabel}
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export interface ActionSheetItemProps {
  onSelect?: (event: Event) => void;
  /** Deletes or loses data. Red in both forms; confirm separately, colour is not consent. */
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function ActionSheetItem({
  onSelect,
  destructive = false,
  disabled = false,
  icon,
  className,
  children,
}: ActionSheetItemProps): JSX.Element {
  if (!use(SheetModeContext)) {
    return (
      <DropdownMenuItem
        destructive={destructive}
        disabled={disabled}
        className={className}
        {...(onSelect ? { onSelect } : {})}
      >
        {icon}
        {children}
      </DropdownMenuItem>
    );
  }
  return (
    <DialogPrimitive.Close
      disabled={disabled}
      onClick={(event) => onSelect?.(event.nativeEvent)}
      className={cn(action, destructive && 'text-danger-fg', className)}
    >
      {icon}
      {children}
    </DialogPrimitive.Close>
  );
}

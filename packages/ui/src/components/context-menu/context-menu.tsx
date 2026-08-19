'use client';

import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * The right-click menu.
 *
 * ### The rule that decides whether you may use one
 *
 * **Every command in a context menu must exist somewhere else too.** A
 * right-click is undiscoverable: new users never find it, and on a touch
 * device it is a long-press that competes with text selection and with the
 * browser's own menu. So it is an *accelerator* for people who already know
 * the command exists, never the only route to it. If "Terminate employment"
 * lives only here. It does not exist.
 *
 * The usual pairing: the same commands in a row's `DropdownMenu`, and the
 * context menu on the row for the people who work the queue all day.
 *
 * ### Keyboard
 *
 * Radix opens on the platform's context-menu key (**Shift+F10**, or the menu
 * key on a full keyboard) as well as on right-click, and arrow keys, typeahead
 * and Escape all behave. That is more than most implementations manage, but it
 * still does not make the menu discoverable, which is why the rule above holds.
 *
 * ### Touch
 *
 * A long-press opens it, and Radix suppresses the resulting synthetic click.
 * On iOS the long-press also triggers the system text-selection callout, which
 * cannot be prevented without breaking selection everywhere; `select-none` on
 * the trigger is the trade this makes on a row that is not meant to be
 * selected anyway.
 */

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

const surface = [
  'z-50 min-w-[11rem] overflow-hidden rounded-md border border-border bg-surface p-1',
  'text-fg shadow-lg',
  // The menu grows from the pointer, which is what ties it to the thing that
  // was right-clicked rather than to the corner of the screen.
  'origin-(--radix-context-menu-content-transform-origin)',
  'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
];

const item = [
  'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-base',
  'outline-none select-none [&_svg]:size-4 [&_svg]:text-fg-subtle',
  'transition-colors duration-(--animate-duration-instant)',
  'data-highlighted:bg-surface-hover data-highlighted:text-fg',
  'data-disabled:pointer-events-none data-disabled:text-fg-disabled',
  // Coarse pointers get the tap floor: a long-press that opens a menu of 28px
  // rows is a menu you cannot then hit.
  'touch:min-h-tap',
];

export interface ContextMenuTriggerProps extends ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Trigger
> {
  /**
   * Marks the surface as right-clickable with a faint dotted underline on
   * hover. Off by default: on a table row the affordance is the row, and a
   * hundred dotted rows is noise.
   */
  hint?: boolean;
}

export function ContextMenuTrigger({
  className,
  hint = false,
  ...props
}: ContextMenuTriggerProps): JSX.Element {
  return (
    <ContextMenuPrimitive.Trigger
      className={cn(
        // `select-none` so a long-press opens the menu rather than starting a
        // text selection. Only correct on a surface whose text nobody needs to
        // copy: pass `select-text` back for one that does.
        'select-none',
        hint &&
          'rounded-sm underline decoration-border-strong decoration-dotted underline-offset-4 transition-colors hover:decoration-fg-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuContent({
  className,
  collisionPadding = 12,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>): JSX.Element {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        // Without padding a menu opened near the bottom of a phone renders
        // under the browser chrome, where nothing can scroll it into view.
        collisionPadding={collisionPadding}
        className={cn(
          surface,
          'max-h-(--radix-context-menu-content-available-height) overflow-y-auto',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export interface ContextMenuItemProps extends ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Item
> {
  /** Irreversible or data-losing. Confirm separately; colour is not consent. */
  destructive?: boolean;
  /** Right-aligned shortcut hint. Only print one the command actually has. */
  shortcut?: string;
}

export function ContextMenuItem({
  className,
  destructive = false,
  shortcut,
  children,
  ...props
}: ContextMenuItemProps): JSX.Element {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        item,
        destructive &&
          'text-danger-fg data-highlighted:bg-danger-subtle data-highlighted:text-danger-fg [&_svg]:text-current',
        className,
      )}
      {...props}
    >
      {children}
      {shortcut ? (
        <span className="ms-auto ps-4 font-sans text-2xs tracking-wide text-fg-subtle">
          {shortcut}
        </span>
      ) : null}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>): JSX.Element {
  return (
    <ContextMenuPrimitive.CheckboxItem className={cn(item, 'ps-8', className)} {...props}>
      <span className="absolute left-2 grid size-4 place-items-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="size-3.5 animate-scale-in" aria-hidden />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

export function ContextMenuRadioItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>): JSX.Element {
  return (
    <ContextMenuPrimitive.RadioItem className={cn(item, 'ps-8', className)} {...props}>
      <span className="absolute left-2 grid size-4 place-items-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="size-2 animate-scale-in fill-current" aria-hidden />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>): JSX.Element {
  return (
    <ContextMenuPrimitive.Label
      className={cn(
        'px-2 py-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>): JSX.Element {
  return (
    <ContextMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>): JSX.Element {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(item, 'data-[state=open]:bg-surface-hover', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ms-auto size-4" aria-hidden />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>): JSX.Element {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent className={cn(surface, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}

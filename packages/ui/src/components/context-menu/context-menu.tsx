'use client';

import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';
import {
  boundaryOf,
  menuIndicator,
  menuItem,
  menuItemDestructive,
  menuItemIndented,
  menuLabel,
  menuSeparator,
  menuShortcut,
  menuSurface,
} from '../../lib/menu';
import { usePortalContainer } from '../../lib/portal-container';

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
  ...menuSurface,
  // The menu grows from the pointer, which is what ties it to the thing that
  // was right-clicked rather than to the corner of the screen.
  'origin-(--radix-context-menu-content-transform-origin)',
];

// Rows are the tap floor and more under a coarse pointer: a long-press that
// opens a menu of 28px rows is a menu you cannot then hit.
const item = menuItem;

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
  const container = usePortalContainer();
  return (
    <ContextMenuPrimitive.Portal container={container}>
      <ContextMenuPrimitive.Content
        // Without padding a menu opened near the bottom of a phone renders
        // under the browser chrome, where nothing can scroll it into view.
        collisionPadding={collisionPadding}
        {...boundaryOf(container)}
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
      className={cn(item, destructive && menuItemDestructive, className)}
      {...props}
    >
      {children}
      {shortcut ? <span className={menuShortcut}>{shortcut}</span> : null}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>): JSX.Element {
  return (
    <ContextMenuPrimitive.CheckboxItem className={cn(item, menuItemIndented, className)} {...props}>
      <span className={menuIndicator}>
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="animate-scale-in text-accent-fg!" aria-hidden />
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
    <ContextMenuPrimitive.RadioItem className={cn(item, menuItemIndented, className)} {...props}>
      <span className={menuIndicator}>
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="size-2! animate-scale-in fill-current text-accent!" aria-hidden />
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
  return <ContextMenuPrimitive.Label className={cn(menuLabel, className)} {...props} />;
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>): JSX.Element {
  return <ContextMenuPrimitive.Separator className={cn(menuSeparator, className)} {...props} />;
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>): JSX.Element {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(item, 'data-[state=open]:bg-surface-sunken', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ms-auto text-fg-subtle!" aria-hidden />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>): JSX.Element {
  const container = usePortalContainer();
  return (
    <ContextMenuPrimitive.Portal container={container}>
      <ContextMenuPrimitive.SubContent
        className={cn(surface, className)}
        {...boundaryOf(container)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

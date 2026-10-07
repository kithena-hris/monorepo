import * as DropdownMenuPrimitive from '@rn-primitives/dropdown-menu';
import { type ReactNode } from 'react';

import { FloatingRoot, useTriggerHandle, type FloatingState } from '../../lib/floating.tsx';
import { menuParts } from './menu-parts.tsx';

/**
 * A list of actions or options behind a button. On a phone it opens on a
 * press (there is no hover) below the button, or above it when there is no
 * room. Every action in it should also be reachable another way, or named
 * plainly enough on the button that people look.
 *
 * Controlled (`open`, `onOpenChange`) or not (`defaultOpen`), as Radix's.
 */
export type DropdownMenuProps = FloatingState & {
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

export function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: DropdownMenuProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Root {...(onOpenChange ? { onOpenChange } : {})}>
      <FloatingRoot
        open={open}
        defaultOpen={defaultOpen}
        useRoot={DropdownMenuPrimitive.useRootContext}
      >
        {children}
      </FloatingRoot>
    </DropdownMenuPrimitive.Root>
  );
}

/** The button that opens it: one child, which receives the trigger's props. */
export function DropdownMenuTrigger({ children }: { children: ReactNode }): React.JSX.Element {
  const handle = useTriggerHandle();
  return (
    <DropdownMenuPrimitive.Trigger ref={handle as never} asChild>
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
}

const parts = menuParts(DropdownMenuPrimitive);

export const DropdownMenuContent = parts.MenuContent;
export const DropdownMenuItem = parts.MenuItem;
export const DropdownMenuCheckboxItem = parts.MenuCheckboxItem;
export const DropdownMenuRadioItem = parts.MenuRadioItem;
export const DropdownMenuLabel = parts.MenuLabel;
export const DropdownMenuSeparator = parts.MenuSeparator;
export const DropdownMenuSubTrigger = parts.MenuSubTrigger;
export const DropdownMenuSubContent = parts.MenuSubContent;
export const DropdownMenuGroup = parts.Group;
export const DropdownMenuRadioGroup = parts.RadioGroup;
export const DropdownMenuSub = parts.Sub;

export type {
  MenuCheckboxItemProps as DropdownMenuCheckboxItemProps,
  MenuContentProps as DropdownMenuContentProps,
  MenuItemProps as DropdownMenuItemProps,
  MenuRadioItemProps as DropdownMenuRadioItemProps,
} from './menu-parts.tsx';

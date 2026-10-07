import * as ContextMenuPrimitive from '@rn-primitives/context-menu';
import type * as DropdownMenuPrimitive from '@rn-primitives/dropdown-menu';
import { useRef, type ReactNode } from 'react';

import { FloatingRoot, useTriggerHandle, WEB, type FloatingState } from '../../lib/floating.tsx';
import { menuParts } from '../dropdown-menu/menu-parts.tsx';

/**
 * The actions of the thing under a finger: a long press on a row (on the
 * web, a right click, or a long press on a touch screen). It is a shortcut,
 * never the only way: every action in it must also be somewhere visible, a
 * row's ⋯ button opening the same menu.
 *
 * VoiceOver and TalkBack reach it through the row's "Show actions" action.
 */
export type ContextMenuProps = FloatingState & {
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

export function ContextMenu({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: ContextMenuProps): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Root
      // On a device the menu opens at the row, not at the finger.
      relativeTo="trigger"
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <FloatingRoot
        open={open}
        defaultOpen={defaultOpen}
        useRoot={ContextMenuPrimitive.useRootContext}
      >
        {children}
      </FloatingRoot>
    </ContextMenuPrimitive.Root>
  );
}

type DomNode = {
  getBoundingClientRect: () => { left: number; bottom: number };
  dispatchEvent: (event: unknown) => boolean;
};
type MouseEventConstructor = new (type: string, init: object) => unknown;

/**
 * The row or item it belongs to: one child, which receives the trigger's
 * props and must pass them to its pressable.
 */
export function ContextMenuTrigger({ children }: { children: ReactNode }): React.JSX.Element {
  const handle = useTriggerHandle();
  const node = useRef<DomNode | null>(null);
  return (
    <ContextMenuPrimitive.Trigger
      ref={(element: unknown) => {
        if (!WEB) {
          handle.current = element as typeof handle.current;
          return;
        }
        node.current = element as DomNode | null;
        // On the web the primitive cannot be opened from code; a context
        // menu opens where it was asked for, so ask for it at the row.
        handle.current = {
          open: () => {
            const target = node.current;
            const Mouse = (globalThis as { MouseEvent?: MouseEventConstructor }).MouseEvent;
            if (!target || !Mouse) return;
            const { left, bottom } = target.getBoundingClientRect();
            target.dispatchEvent(
              new Mouse('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: left,
                clientY: bottom,
              }),
            );
          },
        };
      }}
      accessibilityActions={[{ name: 'longpress', label: 'Show actions' }]}
      asChild
    >
      {children}
    </ContextMenuPrimitive.Trigger>
  );
}

const parts = menuParts(ContextMenuPrimitive as unknown as typeof DropdownMenuPrimitive);

export const ContextMenuContent = parts.MenuContent;
export const ContextMenuItem = parts.MenuItem;
export const ContextMenuCheckboxItem = parts.MenuCheckboxItem;
export const ContextMenuRadioItem = parts.MenuRadioItem;
export const ContextMenuLabel = parts.MenuLabel;
export const ContextMenuSeparator = parts.MenuSeparator;
export const ContextMenuSubTrigger = parts.MenuSubTrigger;
export const ContextMenuSubContent = parts.MenuSubContent;
export const ContextMenuGroup = parts.Group;
export const ContextMenuRadioGroup = parts.RadioGroup;
export const ContextMenuSub = parts.Sub;

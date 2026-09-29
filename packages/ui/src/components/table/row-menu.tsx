'use client';

import { Ellipsis } from 'lucide-react';
import type { JSX } from 'react';

import { keysOf, useShortcutKeys, type RowAction } from '../../lib/shortcut-keys';
import { Button } from '../button/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';
import { KbdShortcut } from '../kbd/kbd';

/**
 * A row's actions, as a menu at its end: each with its keys on the right,
 * the keys that run it while the row has focus.
 */
export function RowMenu({
  name,
  actions,
}: {
  name: string;
  actions: readonly RowAction[];
}): JSX.Element | null {
  const keys = useShortcutKeys();
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${name}`}
          startIcon={<Ellipsis aria-hidden />}
          // Not the row's click: the menu is its own target.
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {actions.map((action) => {
          const shortcut = keysOf(action.shortcut, keys);
          return (
            <DropdownMenuItem
              key={action.id}
              destructive={action.destructive ?? false}
              disabled={action.disabled ?? false}
              onSelect={action.onSelect}
            >
              {action.icon}
              {action.label}
              {shortcut.length === 0 ? null : (
                <DropdownMenuShortcut className="flex">
                  <KbdShortcut keys={shortcut} />
                </DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

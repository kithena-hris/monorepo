'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';
import type { TertiaryNavItem } from './nav';

export interface TertiaryNavMenuProps {
  /** Names the menu button. */
  label: string;
  items: readonly TertiaryNavItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  /** As on `TertiaryNav`. */
  current?: 'location' | 'page';
  className?: string;
}

/**
 * `TertiaryNav` folded into a menu, for a page header with no room for a
 * column. The button says where the reader is; the menu, where else they can
 * go.
 */
export function TertiaryNavMenu({
  label,
  items,
  activeId,
  onSelect,
  current = 'location',
  className,
}: TertiaryNavMenuProps): JSX.Element {
  const active = items.find((item) => item.id === activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`${label}: ${active?.label ?? 'choose a section'}`}
          endIcon={<ChevronsUpDown aria-hidden />}
          className={cn('touch:w-full touch:justify-between', className)}
        >
          {active?.label ?? label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-55">
        {items.map((item) => (
          <DropdownMenuItem key={item.id} asChild>
            <a
              href={item.href ?? `#${item.id}`}
              aria-current={item.id === activeId ? current : undefined}
              onClick={() => {
                onSelect?.(item.id);
              }}
            >
              <span className="flex-1">{item.label}</span>
              {item.id === activeId ? (
                <Check aria-hidden className="size-4 text-accent-fg" />
              ) : null}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

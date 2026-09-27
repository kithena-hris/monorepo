import { X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../popover/popover';

/**
 * A conversation in a small window, opened from a round button that floats
 * in the corner of every page.
 *
 * A window, not a drawer: the page stays in view and usable beside it, so a
 * question can be asked about what is on screen. It stays open while the
 * reader clicks around the page and closes on its close button or Escape,
 * when focus returns to the button that opened it. On a phone it takes the
 * width of the screen less a margin.
 *
 * Presentational: the caller supplies what is inside (usually a `ChatLog` and
 * a `ChatComposer`) and decides where the button floats, clear of anything
 * pinned to the bottom of its own layout.
 */

export interface ChatWindowProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** The floating button's name: "Ask Kithena". Also its tooltip-free label. */
  readonly launcherLabel: string;
  readonly launcherIcon: ReactNode;
  /** Where the button floats. Default: the bottom-right corner. */
  readonly launcherClassName?: string;
  /** The conversation; it scrolls. */
  readonly children: ReactNode;
  /** Pinned under it: the composer. */
  readonly footer?: ReactNode;
}

export function ChatWindow({
  open,
  onOpenChange,
  title,
  description,
  launcherLabel,
  launcherIcon,
  launcherClassName,
  children,
  footer,
}: ChatWindowProps): JSX.Element {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="primary"
          aria-label={launcherLabel}
          startIcon={launcherIcon}
          className={cn(
            'fixed right-6 bottom-6 z-40 size-14 rounded-full shadow-lg [&_svg]:size-6',
            launcherClassName,
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        aria-label={launcherLabel}
        // It is a window beside the page: working on the page does not close it.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        className="flex h-[min(36rem,calc(100dvh-8rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">{title}</p>
            {description === undefined ? null : (
              <p className="text-xs text-fg-muted">{description}</p>
            )}
          </div>
          <PopoverClose asChild>
            <Button size="sm" variant="ghost" aria-label="Close" startIcon={<X aria-hidden />} />
          </PopoverClose>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">{children}</div>
        {footer === undefined ? null : (
          <div className="shrink-0 border-t border-border px-3 py-3">{footer}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

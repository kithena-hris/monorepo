'use client';

import { Slot } from '@radix-ui/react-slot';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Popover, PopoverAnchor, PopoverContent } from '../popover/popover';

/**
 * Introduces one new feature, pointing at the actual control.
 *
 * Wrap the control itself: the callout anchors to it, and with `spotlight` a
 * ring picks it out while a scrim dims the rest of the page. The scrim is a
 * shadow on the control, not a layer over the page, so it catches no clicks;
 * a click anywhere outside the callout dismisses it, as does Escape and Skip.
 *
 * Use it sparingly, and never for something a good label could explain. One
 * tour, three steps at most, shown the first time somebody reaches the
 * feature rather than at sign-in. The caller remembers that it was seen.
 *
 * It opens as a non-modal dialog and moves focus to its own action, so a
 * keyboard user lands in it and a screen reader reads it; closing returns
 * focus to the page.
 */

export interface CoachMarkProps {
  /** The control being introduced. It stays fully usable. */
  children: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A small tag above the title, "New" by default. `null` hides it. */
  badge?: ReactNode;
  /** This step's position in a tour, from 1. Shown as "1 of 3" when `total` is above 1. */
  step?: number;
  total?: number;
  /** Advances the tour. Without it the primary action simply closes the callout. */
  onNext?: () => void;
  nextLabel?: ReactNode;
  /** Shows a Skip action, which also closes. */
  onSkip?: () => void;
  skipLabel?: ReactNode;
  /** Rings the control and dims everything else. */
  spotlight?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function CoachMark({
  children,
  title,
  description,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  badge = 'New',
  step = 1,
  total = 1,
  onNext,
  nextLabel,
  onSkip,
  skipLabel = 'Skip',
  spotlight = false,
  side = 'bottom',
  align = 'center',
}: CoachMarkProps): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const setOpen = (next: boolean): void => {
    setUncontrolled(next);
    onOpenChange?.(next);
  };
  const titleId = useId();
  const last = step >= total;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Slot
          data-coach-mark={open ? 'open' : undefined}
          className={cn(
            spotlight &&
              open &&
              'relative z-40 shadow-[0_0_0_4px_var(--color-accent),0_0_0_100vmax_var(--color-overlay)]',
          )}
        >
          {children}
        </Slot>
      </PopoverAnchor>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={12}
        arrow
        aria-labelledby={titleId}
        // Moving focus elsewhere is not a dismissal: a tour step waits for
        // Skip, Escape or a pointer outside, so tabbing back to the page to
        // look at the control does not throw the step away.
        onFocusOutside={(event) => {
          event.preventDefault();
        }}
        className="flex w-70 flex-col gap-2 p-4"
      >
        {badge === null ? null : (
          <Badge tone="accent" size="sm" className="self-start">
            {badge}
          </Badge>
        )}
        <p id={titleId} className="text-md font-bold">
          {title}
        </p>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
        <div className="mt-1 flex items-center gap-1.5">
          {total > 1 ? (
            <span className="text-xs font-medium text-fg-muted tabular-nums">
              {step} of {total}
            </span>
          ) : null}
          <div className="ms-auto flex gap-1.5">
            {onSkip ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onSkip();
                  setOpen(false);
                }}
              >
                {skipLabel}
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (onNext) onNext();
                else setOpen(false);
              }}
            >
              {nextLabel ?? (last ? 'Got it' : 'Next')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A quiet dot for something new. It goes away the first time it is opened,
 * which the caller decides by no longer rendering it.
 *
 * Place it inside the control it marks; the control must be positioned. The
 * label is read as part of the control's name ("Org chart, new"). Under
 * reduced motion it does not pulse and stays solid.
 */
export function CoachMarkDot({
  label = 'New',
  className,
}: {
  label?: string;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'pointer-events-none absolute end-1.5 top-1.5 size-2 rounded-full bg-accent-solid',
        'outline-2 outline-canvas motion-safe:animate-pulse-ring',
        className,
      )}
    >
      <span className="sr-only">, {label}</span>
    </span>
  );
}

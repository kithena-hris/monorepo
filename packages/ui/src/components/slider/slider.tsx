'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A range input, including two-thumb ranges.
 *
 * Sliders are for values where approximate is fine and the range is small,
 * a salary band filter, a notice period in days. They are the wrong control
 * for a value that must be exact: nobody sets a salary to €47,318 by dragging.
 * Pair one with a number input when both matter.
 *
 * The thumb is 20px visually but carries a 44px hit area on a coarse pointer,
 * because a target you cannot land on with a thumb is a control that does not
 * exist on a phone.
 */

export interface SliderProps extends ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Required: each thumb gets its own accessible name from this. */
  label: string;
  /** Names each thumb individually for a range. `['Minimum', 'Maximum']`. */
  thumbLabels?: readonly string[];
  /** Rendered above the track, right-aligned. Use it to print the live value. */
  valueDisplay?: ReactNode;
  /** Draws the tick marks. Only sensible when the step count is small. */
  showTicks?: boolean;
}

export function Slider({
  className,
  label,
  thumbLabels,
  valueDisplay,
  showTicks = false,
  min = 0,
  max = 100,
  step = 1,
  ...props
}: SliderProps): JSX.Element {
  const values = props.value ?? props.defaultValue ?? [min];
  const tickCount = Math.round((max - min) / step) + 1;
  const ticks = showTicks && tickCount <= 21 ? Array.from({ length: tickCount }, (_, i) => i) : [];

  return (
    <div className="w-full">
      {valueDisplay ? (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-sm text-fg-muted">{label}</span>
          <span className="text-sm font-medium tabular-nums text-fg">{valueDisplay}</span>
        </div>
      ) : null}
      <SliderPrimitive.Root
        min={min}
        max={max}
        step={step}
        className={cn(
          'relative flex w-full touch-none items-center select-none',
          'data-[orientation=vertical]:h-48 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
          className,
        )}
        {...props}
      >
        <SliderPrimitive.Track
          className={cn(
            'relative grow overflow-hidden rounded-full bg-surface-sunken',
            'h-1.5 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
          )}
        >
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent data-[orientation=vertical]:w-full" />
        </SliderPrimitive.Track>

        {ticks.length > 0 ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 flex justify-between">
            {ticks.map((i) => (
              <span key={i} className="size-1 rounded-full bg-border-strong" />
            ))}
          </div>
        ) : null}

        {values.map((_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            aria-label={
              thumbLabels?.[index] ?? (values.length > 1 ? `${label} ${String(index + 1)}` : label)
            }
            className={cn(
              'relative block size-5 rounded-full border-2 border-accent bg-surface shadow-sm',
              'transition-[box-shadow,transform] duration-(--animate-duration-fast) ease-standard',
              'hover:scale-110 active:scale-95',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              'disabled:pointer-events-none disabled:opacity-55',
              // The visible thumb stays 20px; the pseudo-element gives the
              // finger a 44px target without changing the visual weight.
              'touch:after:absolute touch:after:top-1/2 touch:after:left-1/2 touch:after:size-tap',
              'touch:after:-translate-x-1/2 touch:after:-translate-y-1/2 touch:after:content-[""]',
            )}
          />
        ))}
      </SliderPrimitive.Root>
    </div>
  );
}

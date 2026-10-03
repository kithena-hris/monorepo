'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import { ChevronsRight } from 'lucide-react';
import { useState, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react';

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
 *
 * `variant="confirm"` is not a value at all but a deliberate gesture: drag the
 * knob to the end to confirm, for an action a stray tap must not trigger.
 * Let go short of the end and it slides back. From a keyboard, Enter, Space,
 * End or the forward arrows confirm at once: the deliberateness a drag adds
 * for a thumb, a focused control and a key press already have.
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
  /**
   * A dark bubble over each thumb that prints its value. `true` prints the
   * number; a function formats it (`(v) => `${v}%``), and a string it returns
   * also becomes the thumb's `aria-valuetext`, so the formatted value is the
   * one a screen reader hears.
   */
  tip?: boolean | ((value: number) => ReactNode);
  /**
   * Labels under the track, spread from the first step to the last. For a
   * small set of discrete steps, alongside `showTicks`.
   */
  labels?: readonly ReactNode[];
  /** `confirm`: slide to the end to confirm. `label` is printed in the track. */
  variant?: 'default' | 'confirm';
  /** Confirm: called when the knob reaches the end, or a confirming key is pressed. */
  onConfirm?: () => void;
}

const CONFIRM_KEYS = new Set(['Enter', ' ', 'End', 'ArrowRight', 'ArrowUp', 'PageUp']);
const IGNORED_KEYS = new Set(['ArrowLeft', 'ArrowDown', 'PageDown', 'Home']);

function ConfirmSlider({
  label,
  onConfirm,
  disabled,
  className,
}: {
  label: string;
  onConfirm: (() => void) | undefined;
  disabled: boolean | undefined;
  className: string | undefined;
}): JSX.Element {
  const [value, setValue] = useState(0);
  // Sliding back is animated, following the finger never is: a transition
  // during the drag would make the knob lag behind it.
  const [settling, setSettling] = useState(false);

  return (
    <div
      className={cn(
        'relative w-full rounded-full bg-accent-subtle p-1.5',
        disabled && 'opacity-45',
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 grid place-items-center px-16 text-center text-base font-semibold text-accent-fg touch:text-md"
        style={{ opacity: 1 - value / 100 }}
      >
        {label}
      </span>
      <SliderPrimitive.Root
        value={[value]}
        max={100}
        step={1}
        disabled={disabled ?? false}
        onPointerDown={() => {
          setSettling(false);
        }}
        onValueChange={([next = 0]) => {
          setValue(next);
        }}
        onValueCommit={([next = 0]) => {
          if (next >= 100) onConfirm?.();
          setSettling(true);
          setValue(0);
        }}
        className={cn(
          'relative flex h-control-lg touch-none items-center select-none',
          settling &&
            'motion-safe:[&>span:has(>[role=slider])]:transition-[left] motion-safe:[&>span:has(>[role=slider])]:duration-(--animate-duration-normal) motion-safe:[&>span:has(>[role=slider])]:ease-standard',
        )}
      >
        <SliderPrimitive.Track className="absolute inset-0" />
        <SliderPrimitive.Thumb
          aria-label={label}
          onKeyDown={(event) => {
            if (CONFIRM_KEYS.has(event.key)) {
              event.preventDefault();
              onConfirm?.();
            } else if (IGNORED_KEYS.has(event.key)) {
              event.preventDefault();
            }
          }}
          className={cn(
            'grid size-control-lg place-items-center rounded-full bg-accent-solid text-fg-on-accent shadow-md',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            '[&_svg]:size-5 touch:[&_svg]:size-6',
          )}
        >
          <ChevronsRight aria-hidden />
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Root>
    </div>
  );
}

export function Slider({
  className,
  label,
  thumbLabels,
  valueDisplay,
  showTicks = false,
  tip,
  labels,
  variant = 'default',
  onConfirm,
  min = 0,
  max = 100,
  step = 1,
  ...props
}: SliderProps): JSX.Element {
  if (variant === 'confirm') {
    return (
      <ConfirmSlider
        label={label}
        onConfirm={onConfirm}
        disabled={props.disabled}
        className={className}
      />
    );
  }
  const values = props.value ?? props.defaultValue ?? [min];
  const tickCount = Math.round((max - min) / step) + 1;
  const low = values.length > 1 ? (values[0] ?? min) : min;
  const high = values[values.length - 1] ?? min;
  const inRange = (tick: number): boolean => tick >= low && tick <= high;
  const ticks = showTicks && tickCount <= 21 ? Array.from({ length: tickCount }, (_, i) => i) : [];
  const vertical = props.orientation === 'vertical';
  const format = typeof tip === 'function' ? tip : (value: number): ReactNode => value;

  return (
    // The tip floats above the thumb, so a horizontal slider reserves its height.
    <div className={cn(vertical ? 'w-auto' : 'w-full', tip && !vertical && 'pt-7.5')}>
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
          'relative flex h-5 w-full touch-none items-center select-none touch:h-7',
          'data-disabled:opacity-45',
          'data-[orientation=vertical]:h-48 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
          className,
        )}
        {...props}
      >
        <SliderPrimitive.Track
          className={cn(
            'relative grow overflow-hidden rounded-full bg-surface-active',
            'h-1.5 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
          )}
        >
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent data-[disabled]:bg-fg-subtle data-[orientation=vertical]:w-full" />
        </SliderPrimitive.Track>

        {ticks.length > 0 ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 flex justify-between">
            {ticks.map((i) => (
              <span
                key={i}
                className={cn(
                  'size-1 rounded-full',
                  // A tick under the filled range is a light dot on the accent.
                  inRange(min + i * step) ? 'bg-fg-on-accent/70' : 'bg-fg-subtle',
                )}
              />
            ))}
          </div>
        ) : null}

        {values.map((value, index) => {
          const shown = tip ? format(value) : null;
          return (
            <SliderPrimitive.Thumb
              key={index}
              aria-label={
                thumbLabels?.[index] ??
                (values.length > 1 ? `${label} ${String(index + 1)}` : label)
              }
              aria-valuetext={typeof shown === 'string' ? shown : undefined}
              className={cn(
                // White, shadowed, no border: a physical knob. 20px at a desk,
                // 28px under a thumb.
                'tap-target relative block size-5 rounded-full bg-fg-on-accent touch:size-7',
                'shadow-[0_1px_4px_oklch(0%_0_0/0.3),0_0_0_0.5px_oklch(0%_0_0/0.12)]',
                'transition-[box-shadow,transform] duration-(--animate-duration-fast) ease-standard',
                'hover:scale-110 active:scale-95 motion-reduce:hover:scale-100 motion-reduce:active:scale-100',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                'disabled:pointer-events-none disabled:opacity-55',
                // The visible thumb stays 20px; the pseudo-element gives the
                // finger a 44px target without changing the visual weight.
                'touch:after:absolute touch:after:top-1/2 touch:after:left-1/2 touch:after:size-tap',
                'touch:after:-translate-x-1/2 touch:after:-translate-y-1/2 touch:after:content-[""]',
              )}
            >
              {tip ? (
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute rounded-[0.5rem] bg-invert px-2 py-1 text-xs leading-none font-semibold whitespace-nowrap text-fg-on-invert tabular-nums',
                    vertical
                      ? 'top-1/2 left-[calc(100%+0.5rem)] -translate-y-1/2'
                      : 'bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2',
                  )}
                >
                  {shown}
                </span>
              ) : null}
            </SliderPrimitive.Thumb>
          );
        })}
      </SliderPrimitive.Root>
      {labels && labels.length > 0 ? (
        <div
          aria-hidden
          className="mt-2.5 flex justify-between text-xs leading-none font-medium text-fg-subtle"
        >
          {labels.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

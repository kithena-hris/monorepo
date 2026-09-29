'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';
import { Spinner } from '../spinner/spinner';

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  /**
   * The change is being saved. The thumb carries a spinner, the switch is
   * `aria-busy`, and it ignores further presses until the write settles, at
   * full opacity, because it has not been refused, only not yet confirmed.
   * If the write fails, put `checked` back and say so in a `FieldError`.
   */
  loading?: boolean;
}

/*
 * The track and its thumb, apart from the button: a menu row that toggles a
 * setting draws the same switch as its indicator (`DropdownMenuCheckboxItem`
 * with `indicator="switch"`), where the row is the control and the switch is
 * only how its state looks. Both follow `data-state`, as Radix sets it.
 */
export const switchTrack = [
  // 36 x 22 at a desk; the 51 x 31 a phone's own switches use under a
  // thumb, where "on" is the platform's green rather than the accent.
  'peer relative inline-flex h-[1.375rem] w-9 shrink-0 items-center rounded-full',
  'touch:h-[1.9375rem] touch:w-[3.1875rem]',
  'bg-surface-active',
  'transition-[background-color,transform] duration-(--animate-duration-fast) ease-standard',
  'data-[state=checked]:bg-accent touch:data-[state=checked]:bg-success-solid',
];

export const switchThumb = [
  'pointer-events-none grid size-[1.125rem] place-items-center rounded-full bg-fg-on-accent ring-0 touch:size-[1.6875rem]',
  'shadow-[0_1px_3px_oklch(0%_0_0/0.25)]',
  /*
   * The thumb is the one part of a switch that is a physical object: it
   * is a thing that slides in a track, and it is the only element on the
   * screen the user thinks of as having been pushed. A spring is what
   * that looks like, and `--ease-spring-snap` is critically damped, so
   * it arrives without a bounce, a toggle that wobbles reads as
   * uncertain about a value the user just set.
   *
   * The track keeps `ease-standard` above. Colour has no mass, and
   * springing a fill produces a visible hesitation in the middle of the
   * crossfade.
   */
  'transition-transform duration-(--animate-duration-spring-snap) ease-spring-snap',
  'translate-x-0.5 data-[state=checked]:translate-x-4 touch:data-[state=checked]:translate-x-[1.375rem]',
  'rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-4 touch:rtl:data-[state=checked]:-translate-x-[1.375rem]',
];

/**
 * Immediate on/off.
 *
 * A switch commits the moment it moves. If the setting needs a Save button,
 * it is a checkbox, not a switch.
 */
export function Switch({
  className,
  loading = false,
  onClick,
  ...props
}: SwitchProps): JSX.Element {
  return (
    <SwitchPrimitive.Root
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      onClick={(event) => {
        // Radix skips its toggle when the event is already prevented, which
        // covers Space and Enter too: both arrive here as a click.
        if (loading) event.preventDefault();
        onClick?.(event);
      }}
      className={cn(
        switchTrack,
        'cursor-pointer tap-target',
        // Confirms the press on pointer-down, before the state has flipped.
        'active:scale-[0.97] motion-reduce:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'aria-invalid:data-[state=checked]:bg-danger-solid',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-loading:cursor-progress',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className={cn(switchThumb)}>
        {loading ? (
          <Spinner
            size={null}
            label="Saving"
            className="text-accent-fg [&_svg]:size-2.5 touch:[&_svg]:size-[1.1875rem]"
          />
        ) : null}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

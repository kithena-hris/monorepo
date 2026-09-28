'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

export type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

/**
 * Immediate on/off.
 *
 * A switch commits the moment it moves. If the setting needs a Save button,
 * it is a checkbox, not a switch.
 */
export function Switch({ className, ...props }: SwitchProps): JSX.Element {
  return (
    <SwitchPrimitive.Root
      className={cn(
        // 36 x 22 at a desk; the 51 x 31 a phone's own switches use under a
        // thumb, where "on" is the platform's green rather than the accent.
        'peer relative inline-flex h-[1.375rem] w-9 shrink-0 cursor-pointer items-center rounded-full',
        'touch:h-[1.9375rem] touch:w-[3.1875rem]',
        'tap-target',
        'bg-surface-active',
        'transition-[background-color,transform] duration-(--animate-duration-fast) ease-standard',
        // Confirms the press on pointer-down, before the state has flipped.
        'active:scale-[0.97] motion-reduce:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'data-[state=checked]:bg-accent touch:data-[state=checked]:bg-success-solid',
        'aria-invalid:data-[state=checked]:bg-danger-solid',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-[1.125rem] rounded-full bg-fg-on-accent ring-0 touch:size-[1.6875rem]',
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
        )}
      />
    </SwitchPrimitive.Root>
  );
}

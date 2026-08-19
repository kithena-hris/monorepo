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
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
        'border border-transparent bg-surface-active shadow-xs',
        'transition-[background-color,transform] duration-(--animate-duration-fast) ease-standard',
        // Confirms the press on pointer-down, before the state has flipped.
        'active:scale-[0.97] motion-reduce:active:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-surface shadow-sm ring-0',
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
          'translate-x-0.5 data-[state=checked]:translate-x-[1.125rem]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

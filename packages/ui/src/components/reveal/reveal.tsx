'use client';

import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * Something entering or leaving the page flow, without the shove.
 *
 * ### The problem
 *
 * A selection bar, an inline alert, a filter panel, each one appears above
 * content and displaces it. Rendered conditionally, that displacement happens
 * in a single frame: the page jumps, and whatever the user was reading or
 * about to click is somewhere else. On a board where the bar appears the
 * instant a checkbox is ticked. The jump lands under the pointer.
 *
 * ### Why `height` cannot solve it
 *
 * `height: auto` is not an animatable value, so the naive fix is to hard-code
 * a height, which is wrong the moment the content wraps to two lines, on a
 * narrow screen, in a language with longer words. Measuring it in JS costs a
 * layout read on every render and still misses the reflow.
 *
 * ### `grid-template-rows: 0fr → 1fr`
 *
 * A grid track *is* animatable, and `1fr` resolves to exactly the content's
 * height whatever that turns out to be. The child needs `min-height: 0` and
 * `overflow: hidden`, and that is the entire technique. It is the only
 * approach that animates to an unknown height without measuring anything.
 *
 * `content-visibility` and `interpolate-size: allow-keywords` will make this
 * redundant eventually; neither has the support to rely on yet.
 *
 * ### What it does not do
 *
 * It does not unmount its children on exit by default. The content stays in
 * the DOM, collapsed and `inert`, so an exit animation has something to
 * animate. Pass `unmountOnExit` when the content is expensive, and accept that
 * the exit becomes instant.
 */

export interface RevealProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  open: boolean;
  children: ReactNode;
  /** Milliseconds. Defaults to the system's `normal` duration. */
  duration?: number;
  /** Slides as well as collapsing. The direction it comes *from*. */
  from?: 'top' | 'bottom' | 'none';
  /**
   * Remove the children from the DOM once collapsed. Cheaper for heavy
   * content; costs the exit animation.
   */
  unmountOnExit?: boolean;
  /** Class for the inner wrapper: padding belongs here, not on the root. */
  contentClassName?: string;
}

export function Reveal({
  open,
  children,
  duration,
  from = 'top',
  unmountOnExit = false,
  className,
  contentClassName,
  ...props
}: RevealProps): JSX.Element {
  // Mount-time state matters: a `Reveal` that starts open must not play its
  // entrance, or every page load animates its own furniture in.
  const [mounted, setMounted] = useState(false);
  const [present, setPresent] = useState(open);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (open) {
      setPresent(true);
      return;
    }
    if (!unmountOnExit) return;
    timer.current = setTimeout(() => {
      setPresent(false);
    }, duration ?? 200);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [open, unmountOnExit, duration]);

  const style =
    duration === undefined ? undefined : { transitionDuration: `${String(duration)}ms` };

  return (
    <div
      data-state={open ? 'open' : 'closed'}
      // `grid` plus a single row track. The track, not the element, is what
      // animates: see the docblock.
      className={cn(
        'grid transition-[grid-template-rows] ease-standard',
        'duration-(--animate-duration-normal) motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className,
      )}
      style={style}
      {...props}
    >
      <div
        // `min-h-0` is the half everyone forgets: a grid item's automatic
        // minimum is its content, which pins the track open at `0fr` and makes
        // the whole thing do nothing.
        className={cn(
          'min-h-0 overflow-hidden transition-[opacity,transform] ease-standard',
          'duration-(--animate-duration-normal) motion-reduce:transition-none',
          open ? 'translate-y-0 opacity-100' : 'opacity-0',
          !open && from === 'top' && '-translate-y-1',
          !open && from === 'bottom' && 'translate-y-1',
          // Collapsed content is still focusable unless it is told otherwise,
          // which is how Tab lands on a button nobody can see.
          contentClassName,
        )}
        // Suppressed on the very first paint so an initially-open Reveal does
        // not animate its own arrival.
        inert={!open && mounted ? true : undefined}
        style={style}
      >
        {present || !unmountOnExit ? children : null}
      </div>
    </div>
  );
}

/**
 * Per-item delay for a group that changes state at once: selecting a whole
 * column, filtering a list, a row of chips arriving.
 *
 * Returned as a style object rather than a class because the value is an
 * index: Tailwind cannot generate `delay-[calc(...)]` for an unknown number,
 * and forty hard-coded delay classes is not a design system.
 *
 * The step and the ceiling are tokens, so a stagger is the same speed
 * everywhere and one change re-times all of them.
 */
export function staggerStyle(index: number): { transitionDelay: string } {
  return {
    transitionDelay: `min(calc(${String(index)} * var(--animate-stagger-step)), var(--animate-stagger-max))`,
  };
}

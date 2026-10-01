'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Marks a bar pinned to the bottom of the screen — a form's Save, a bulk
 * selection's actions, a decision's Reject and Approve — so a floating
 * control fixed over the same corner rises above it instead of covering one
 * of its buttons. Spread it on the bar: `<div {...PINNED_BAR}>`.
 */
export const PINNED_BAR = { 'data-pinned-bar': '' } as const;

/** Room between a pinned bar's top and a floating control lifted above it. */
const GAP = 12;

/**
 * How far a floating control must rise to clear every pinned bar it would
 * otherwise sit on (`PINNED_BAR`): 0 when none is under it. The control
 * applies it as a `translateY`, so its own position stays its caller's.
 *
 * Measured, not assumed: a bar's height and whether it is stuck depend on the
 * screen, the scroll and the pointer. Re-measured once per frame at most, on
 * scroll (any scroller, so in capture), on resize, when the page changes
 * size, when something finishes animating, and when a bar appears or goes; a
 * still page measures nothing.
 */
export function useClearOfPinned(ref: RefObject<HTMLElement | null>): number {
  const [lift, setLift] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const self = ref.current?.getBoundingClientRect();
        if (!self) return;
        // Where it sits unlifted: the transform is ours, not its position.
        const top = self.top + current.current;
        const bottom = self.bottom + current.current;
        let need = 0;
        for (const bar of document.querySelectorAll('[data-pinned-bar]')) {
          const r = bar.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const across = r.left < self.right && r.right > self.left;
          const under = r.top < bottom && r.bottom > top;
          if (across && under) need = Math.max(need, bottom - r.top + GAP);
        }
        current.current = need;
        setLift(need);
      });
    };
    measure();
    const bars = new MutationObserver(measure);
    bars.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-pinned-bar'],
    });
    // The page growing or shrinking moves a bar that is not stuck yet.
    // Not every environment has one (jsdom); the other triggers still measure.
    const page = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    page?.observe(document.documentElement);
    // So does content settling after it animates in.
    const moved = ['scroll', 'animationend', 'transitionend'] as const;
    for (const type of moved) window.addEventListener(type, measure, { capture: true, passive: true });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      bars.disconnect();
      page?.disconnect();
      for (const type of moved) window.removeEventListener(type, measure, { capture: true });
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  return lift;
}

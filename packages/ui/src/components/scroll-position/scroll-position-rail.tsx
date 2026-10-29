'use client';

import { useEffect, useState, type JSX, type RefObject } from 'react';

import { cn } from '../../lib/cn';
import { ScrollPosition } from './scroll-position';

/**
 * `ScrollPosition` over a list the window scrolls: `DataTable` and
 * `VirtualList` draw it themselves, and a list of its own (`List`) places it
 * first inside its box, through `LazyScrollPositionRail`. Nothing until the
 * list's top has gone under the page's sticky header; then the count rises
 * into the list's top corner, under whatever the list pins at its top (a
 * table's header, or the element marked `data-list-head`), rides there to the
 * list's end, and goes as the list comes back down. A sticky line of no height.
 */
export function ScrollPositionRail({
  list,
  loaded,
  total,
  className,
}: {
  readonly list: RefObject<HTMLElement | null>;
  readonly loaded: number;
  readonly total: number | null;
  readonly className?: string;
}): JSX.Element | null {
  // Its own state, so a scroll frame draws this and not the list it sits over.
  const [at, setAt] = useState<{ seen: number; pinned: boolean; below: number } | null>(null);
  useEffect(() => {
    const el = list.current;
    if (el === null) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const top =
        Number.parseFloat(getComputedStyle(el).getPropertyValue('--reach-sticky-top')) || 0;
      const box = el.getBoundingClientRect();
      const below =
        el.querySelector('thead, [data-list-head]')?.getBoundingClientRect().height ?? 0;
      const pinned = box.top < top - 1 && box.bottom > top + below;
      // ponytail: read as a share of the list's height, so a row is a row's
      // share; exact per row if rows ever differ much in height.
      const read =
        box.height > 0 ? Math.min(1, Math.max(0, (window.innerHeight - box.top) / box.height)) : 0;
      const seen = Math.round(read * loaded);
      setAt((now) =>
        now === null && !pinned
          ? null
          : now?.pinned === pinned && now.seen === seen && now.below === below
            ? now
            : { seen, pinned, below },
      );
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [list, loaded]);

  if (at === null) return null;
  const toTop = (): void => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  };
  return (
    <div
      className={cn('pointer-events-none sticky z-30 h-0', className)}
      style={{ top: `calc(var(--reach-sticky-top, 0px) + ${String(at.below)}px)` }}
    >
      <ScrollPosition
        seen={at.seen}
        total={total}
        loaded={loaded}
        onBackToTop={toTop}
        // Up from under the list into its corner, the way a flyout opens;
        // held where the way out ends, then gone until the list pins again.
        data-state={at.pinned ? 'open' : 'closed'}
        data-side="top"
        style={{ animationFillMode: 'forwards' }}
        inert={!at.pinned}
        onAnimationEnd={() => {
          setAt((now) => (now?.pinned === false ? null : now));
        }}
        className="absolute end-3 top-2 popover-motion pointer-events-auto data-[state=closed]:pointer-events-none"
      />
    </div>
  );
}

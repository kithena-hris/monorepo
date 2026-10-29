'use client';

import { useEffect, useState, type JSX, type RefObject } from 'react';

import { icons } from '../../icons';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/**
 * Back to the top of a list the window scrolls: `DataTable` and `VirtualList`
 * draw it themselves, and a list of its own (`List`) places it first inside
 * its box, through `LazyScrollPositionRail`. Nothing until the list's top has
 * gone under the page's sticky header; then the button rises into the list's
 * top corner, under whatever the list pins at its top (a table's header, or
 * the element marked `data-list-head`), rides there to the list's end, and
 * goes as the list comes back down. A sticky line of no height.
 *
 * How far down the page the reader is, is the page's to say, once for every
 * page (`PageLayout`'s scroll progress), not each list's.
 */
export function ScrollPositionRail({
  list,
  className,
}: {
  readonly list: RefObject<HTMLElement | null>;
  readonly className?: string;
}): JSX.Element | null {
  // Its own state, and only when it changes, so a scroll frame draws nothing.
  const [at, setAt] = useState<{ pinned: boolean; below: number } | null>(null);
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
      setAt((now) =>
        now === null && !pinned
          ? null
          : now?.pinned === pinned && now.below === below
            ? now
            : { pinned, below },
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
  }, [list]);

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
      <Button
        variant="secondary"
        size="xs"
        endIcon={<icons.up aria-hidden />}
        onClick={toTop}
        // Up from under the list into its corner, the way a flyout opens;
        // held where the way out ends, then gone until the list pins again.
        data-state={at.pinned ? 'open' : 'closed'}
        data-side="top"
        style={{ animationFillMode: 'forwards' }}
        inert={!at.pinned}
        onAnimationEnd={() => {
          setAt((now) => (now?.pinned === false ? null : now));
        }}
        className="absolute end-3 top-2 popover-motion pointer-events-auto shadow-md data-[state=closed]:pointer-events-none"
      >
        {t('components.scroll-position.scroll-position.back_to_top', 'Back to top')}
      </Button>
    </div>
  );
}

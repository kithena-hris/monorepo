'use client';

import { useEffect, useState, type JSX, type ReactNode, type RefObject } from 'react';

import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { formatNumber } from '../../lib/intl';
import { BulkBar } from '../table/bulk-bar';
import { ListMap, ScrollPosition, useRunningCount } from './scroll-position';

/** A selection on the list: the bar it summons takes the pill's place, and keeps its map. */
export interface RailSelection {
  readonly count: number;
  readonly onClear: () => void;
  /** The actions, as `Button`s (`BulkBar`). */
  readonly actions: ReactNode;
}

/**
 * The map and a short count, leading a selection's bar: where the reader is
 * stays in view while rows are picked, in the bar's inverted ink.
 */
function Place({
  from,
  to,
  loaded,
  total,
}: {
  readonly from: number;
  readonly to: number;
  readonly loaded: number;
  readonly total: number | null;
}): JSX.Element {
  const shown = useRunningCount(loaded);
  return (
    <span className="flex items-center gap-2.5 text-sm text-fg-on-invert/75 tabular-nums">
      <ListMap from={from} to={to} loaded={loaded} total={total} invert />
      <span className="whitespace-nowrap">
        {total === null
          ? t('components.scroll-position.scroll-position-rail.so_far', '{{shown}} so far', {
              shown: formatNumber(shown),
            })
          : t('components.scroll-position.scroll-position-rail.of', '{{shown}} of {{total}}', {
              shown: formatNumber(shown),
              total: formatNumber(total),
            })}
      </span>
    </span>
  );
}

/**
 * `ScrollPosition` under a list, sticky to the bottom of the window: on a
 * short list it simply sits beneath the rows, and on a long one it floats at
 * the window's foot, lifted by its shadow, until the list's end comes up to
 * meet it. Rows picked, the same place holds the selection's bar instead
 * (`BulkBar`), led by the same map and count: one thing at the window's foot,
 * which changes what it offers, the way a phone's toolbar becomes the
 * selection's, and the reader never loses their place to it. `DataTable` and `VirtualList` place it
 * themselves; a list of its own places it last inside its box.
 *
 * Which rows are on screen is read from the list's box: the window's scroll
 * when the page scrolls the list, the box's own when it scrolls itself. Its
 * own state, and only when a row comes or goes, so a scroll frame draws
 * nothing else.
 */
export function ScrollPositionRail({
  list,
  loaded,
  total,
  selection,
  className,
}: {
  readonly list: RefObject<HTMLElement | null>;
  readonly loaded: number;
  readonly total: number | null;
  readonly selection?: RailSelection;
  readonly className?: string;
}): JSX.Element {
  const [at, setAt] = useState({ from: 1, to: 1, own: false, floating: false });
  useEffect(() => {
    const el = list.current;
    if (el === null) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const own = el.scrollHeight > el.clientHeight + 1;
      let top: number;
      let bottom: number;
      let height: number;
      let floating: boolean;
      if (own) {
        top = el.scrollTop;
        bottom = el.scrollTop + el.clientHeight;
        height = el.scrollHeight;
        floating = false;
      } else {
        const sticky =
          Number.parseFloat(getComputedStyle(el).getPropertyValue('--reach-sticky-top')) || 0;
        const box = el.getBoundingClientRect();
        top = sticky - box.top;
        bottom = window.innerHeight - box.top;
        height = box.height;
        floating = box.bottom > window.innerHeight;
      }
      // ponytail: rows read as equal shares of the box; exact per row if
      // rows ever differ much in height.
      const row = (y: number): number =>
        height > 0 ? Math.min(loaded, Math.max(0, (y / height) * loaded)) : 0;
      const from = Math.max(1, Math.floor(row(top)) + 1);
      const to = Math.max(from, Math.ceil(row(bottom)));
      setAt((now) =>
        now.from === from && now.to === to && now.own === own && now.floating === floating
          ? now
          : { from, to, own, floating },
      );
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [list, loaded]);

  const toTop = (): void => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = smooth ? 'smooth' : 'auto';
    if (at.own) list.current?.scrollTo({ top: 0, behavior });
    else window.scrollTo({ top: 0, behavior });
  };
  return (
    <div
      className={cn(
        // Clear of the home indicator, and of the phone's tab bar under a finger.
        'pointer-events-none sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex justify-center',
        'touch:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {selection !== undefined && selection.count > 0 ? (
        <BulkBar
          count={selection.count}
          onClear={selection.onClear}
          leading={<Place from={at.from} to={at.to} loaded={loaded} total={total} />}
          // The rail is what sticks; the bar rides inside it.
          className="pointer-events-auto static"
        >
          {selection.actions}
        </BulkBar>
      ) : (
        <ScrollPosition
          from={at.from}
          to={at.to}
          loaded={loaded}
          total={total}
          {...(at.from > 1 ? { onBackToTop: toTop } : {})}
          data-floating={at.floating || undefined}
          className="pointer-events-auto transition-shadow duration-(--animate-duration-normal) ease-standard data-floating:shadow-lg"
        />
      )}
    </div>
  );
}

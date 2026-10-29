'use client';

import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type RefObject,
} from 'react';

import { icons } from '../../icons';
import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/intl';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { CircularProgress } from '../progress/circular-progress';
import { t } from '../../lib/i18n';

export interface ScrollPositionProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** How far the reader has got: the rows up to the last one in view. */
  seen: number;
  /** How many there are in all, or `null` while more are still to load and nobody has counted them. */
  total: number | null;
  /** How many have loaded: what the count is out of while `total` is unknown ("150 of 200+"). */
  loaded?: number;
  /** Scrolls back to the first row. Leave it out near the top, where it goes nowhere. */
  onBackToTop?: () => void;
  backToTopLabel?: string;
}

/**
 * Where you are in a long list that keeps loading: a ring filling as the
 * reader goes, the count beside it, and a way back to the start.
 * `DataTable` and `VirtualList` pin it over a list the window scrolls by
 * themselves (`ScrollPositionRail`); a caller places it only over a list of
 * its own.
 *
 * The count is not a live region. It changes on every page of a scroll, and a
 * screen reader hearing each change hears nothing else; the list announces its
 * own loads.
 */
export function ScrollPosition({
  seen,
  total,
  loaded,
  onBackToTop,
  backToTopLabel = t('components.scroll-position.scroll-position.back_to_top', 'Back to top'),
  className,
  ...props
}: ScrollPositionProps): JSX.Element {
  const count =
    total === null
      ? t('components.scroll-position.scroll-position.of_more', '{{seen}} of {{loaded}}+', {
          seen: formatNumber(seen),
          loaded: formatNumber(loaded ?? seen),
        })
      : t('components.scroll-position.scroll-position.of', '{{seen}} of {{total}}', {
          seen: formatNumber(seen),
          total: formatNumber(total),
        });
  // Decorative: the count beside it says the same in words, so its track is
  // not held to an icon's contrast (`data-decorative`, `tools/a11y`).
  const ring = (
    <span aria-hidden data-decorative className="inline-flex">
      <CircularProgress
        value={seen}
        max={Math.max(1, total ?? loaded ?? seen)}
        size={18}
        showValue={false}
        label={count}
      />
    </span>
  );
  return (
    <div className={cn('flex', className)} {...props}>
      {onBackToTop ? (
        <Button
          variant="secondary"
          size="xs"
          startIcon={ring}
          endIcon={<icons.up aria-hidden />}
          onClick={onBackToTop}
          aria-label={t(
            'components.scroll-position.scroll-position.back_to_top_from',
            '{{count}}. {{back}}',
            { count, back: backToTopLabel },
          )}
          className="tabular-nums shadow-md"
        >
          {count}
        </Button>
      ) : (
        <Badge variant="solid" tone="neutral" size="lg" className="gap-1.5 tabular-nums shadow-md">
          {ring}
          {count}
        </Badge>
      )}
    </div>
  );
}

/**
 * `ScrollPosition` over a list the window scrolls, for `DataTable` and
 * `VirtualList`. Nothing until the list's top has gone under the page's
 * sticky header; then the count rises into the list's top corner, under the
 * table's pinned header, rides there to the list's end, and goes as the list
 * comes back down. Placed before the list, in a sticky line of no height.
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
      const below = el.querySelector('thead')?.getBoundingClientRect().height ?? 0;
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

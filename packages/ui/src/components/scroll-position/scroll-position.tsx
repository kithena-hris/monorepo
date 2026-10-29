'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type JSX } from 'react';

import { icons } from '../../icons';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { formatNumber } from '../../lib/intl';
import { Button } from '../button/button';

export interface ScrollPositionProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** The first row in view, from 1. */
  from: number;
  /** The last row in view. */
  to: number;
  /** How many have loaded. */
  loaded: number;
  /** How many there are in all, or `null` while more are still to load and nobody has counted them. */
  total: number | null;
  /** Scrolls back to the first row. Leave it out near the top, where it goes nowhere. */
  onBackToTop?: () => void;
  backToTopLabel?: string;
}

/** How long a count takes to run from one number to the next, in ms. */
const COUNT_MS = 450;

/**
 * A number that runs to its new value rather than jumping to it: 200 rolls up
 * to 400 as a page lands. The first render is the value itself, so the server
 * and the browser agree; under reduced motion it changes at once.
 */
function useRunningCount(value: number): number {
  const [shown, setShown] = useState(value);
  const at = useRef(value);
  useEffect(() => {
    const start = at.current;
    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (start === value || still) {
      at.current = value;
      setShown(value);
      return undefined;
    }
    let frame = 0;
    let began = 0;
    const step = (now: number): void => {
      began ||= now;
      const p = Math.min(1, (now - began) / COUNT_MS);
      // Out fast, in gently: the ease a count settles with.
      at.current = Math.round(start + (value - start) * (1 - (1 - p) ** 3));
      setShown(at.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return shown;
}

const share = (part: number, whole: number): string =>
  `${String(whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0)}%`;

/**
 * Where you are in a long list: a map of it, its count, and a way back.
 *
 * The map is the list laid on its side. Its track is every row there is, the
 * wash over it the rows loaded so far, and the bright segment the rows on
 * screen, gliding along as the reader scrolls and back as they return. The
 * count runs up as pages land: "Showing 200 of 1,003", "Showing all 1,003".
 *
 * `DataTable` and `VirtualList` float it at the bottom of the window over a
 * long list (`ScrollPositionRail`), and set it under a short one. The count is
 * not a live region: it changes with every page loaded, and the list
 * announces its own loads.
 */
export function ScrollPosition({
  from,
  to,
  loaded,
  total,
  onBackToTop,
  backToTopLabel = t('components.scroll-position.scroll-position.back_to_top', 'Back to top'),
  className,
  ...props
}: ScrollPositionProps): JSX.Element {
  const shown = useRunningCount(loaded);
  const all = total ?? loaded;
  const count =
    total === null
      ? t('components.scroll-position.scroll-position.so_far', 'Showing {{shown}} so far', {
          shown: formatNumber(shown),
        })
      : shown >= total
        ? t('components.scroll-position.scroll-position.all', 'Showing all {{total}}', {
            total: formatNumber(total),
          })
        : t('components.scroll-position.scroll-position.of', 'Showing {{shown}} of {{total}}', {
            shown: formatNumber(shown),
            total: formatNumber(total),
          });
  return (
    <div
      className={cn(
        'inline-flex h-9 items-center gap-3 rounded-full border border-border bg-surface ps-3.5 text-sm text-fg tabular-nums',
        onBackToTop ? 'pe-1' : 'pe-4',
        className,
      )}
      {...props}
    >
      {/* Decorative: the count beside it says it in words (`data-decorative`, `tools/a11y`). */}
      <span
        aria-hidden
        data-decorative
        className="relative h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface-sunken"
      >
        <span
          className="absolute inset-y-0 start-0 rounded-full bg-accent/40 transition-[width] duration-500 ease-standard motion-reduce:transition-none"
          style={{ width: share(loaded, all) }}
        />
        <span
          className="absolute inset-y-0 rounded-full bg-accent transition-[inset-inline-start,width] duration-300 ease-standard motion-reduce:transition-none"
          style={{
            insetInlineStart: share(from - 1, all),
            // Never thinner than a dot, however long the list.
            width: `max(0.375rem, ${share(to - from + 1, all)})`,
          }}
        />
      </span>
      <span className="whitespace-nowrap">{count}</span>
      {onBackToTop ? (
        <Button
          variant="ghost"
          size="xs"
          startIcon={<icons.up aria-hidden />}
          aria-label={backToTopLabel}
          onClick={onBackToTop}
          className="rounded-full motion-safe:animate-pop-in"
        />
      ) : null}
    </div>
  );
}

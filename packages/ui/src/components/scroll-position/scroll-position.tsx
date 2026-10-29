'use client';

import type { ComponentPropsWithoutRef, JSX } from 'react';

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

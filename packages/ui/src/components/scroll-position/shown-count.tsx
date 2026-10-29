import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { formatNumber } from '../../lib/intl';

/**
 * How many a long list holds, said once above it: "Showing 150 of 388", or
 * "Showing all 388" once every row has loaded. `DataTable` and `VirtualList`
 * draw it when they are given a `total`. Not a live region: it changes with
 * every page loaded, and the list announces its own loads.
 */
export function ShownCount({
  shown,
  total,
  className,
}: {
  readonly shown: number;
  readonly total: number;
  readonly className?: string;
}): JSX.Element {
  return (
    <p className={cn('text-sm text-fg-muted tabular-nums', className)}>
      {shown >= total
        ? t('components.scroll-position.shown-count.all', 'Showing all {{total}}', {
            total: formatNumber(total),
          })
        : t('components.scroll-position.shown-count.of', 'Showing {{shown}} of {{total}}', {
            shown: formatNumber(shown),
            total: formatNumber(total),
          })}
    </p>
  );
}

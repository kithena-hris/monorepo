import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';

/**
 * Pages of results. On a phone it is "Page 3 of 52" between two arrows at the
 * edges, where a thumb finds them: a numbered window is a poor control under
 * a finger. `numbered` draws the window instead, elided rather than in full,
 * for a tablet or a short set. A long list on a phone usually loads more as
 * it scrolls instead.
 */
export type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Draw the numbered window instead of "Page 3 of 52". */
  numbered?: boolean;
  /** Pages either side of the current one before eliding. */
  siblings?: number;
  /** Names it for a screen reader, for a screen with more than one. */
  label?: string;
  className?: string | undefined;
};

const ELLIPSIS = 'ellipsis' as const;

/**
 * The numbered window, as the web's: first, last, the current page and its
 * siblings, and an ellipsis for each gap. Below that many pages nothing is
 * hidden, since the full list is shorter than the elided one.
 */
export function paginationRange(
  page: number,
  pageCount: number,
  siblings: number,
): readonly (number | typeof ELLIPSIS)[] {
  const total = siblings * 2 + 5;
  if (pageCount <= total) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, pageCount);
  const showLeft = left > 2;
  const showRight = right < pageCount - 1;
  const count = siblings * 2 + 3;
  if (!showLeft && showRight) {
    return [...Array.from({ length: count }, (_, i) => i + 1), ELLIPSIS, pageCount];
  }
  if (showLeft && !showRight) {
    return [1, ELLIPSIS, ...Array.from({ length: count }, (_, i) => pageCount - count + 1 + i)];
  }
  return [
    1,
    ELLIPSIS,
    ...Array.from({ length: right - left + 1 }, (_, i) => left + i),
    ELLIPSIS,
    pageCount,
  ];
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  numbered = false,
  siblings = 1,
  label = 'Pagination',
  className,
}: PaginationProps): React.JSX.Element {
  const previous = (
    <Button
      size="sm"
      startIcon={<Icon icon={ChevronLeft} />}
      accessibilityLabel="Previous page"
      disabled={page <= 1}
      onPress={() => {
        onPageChange(page - 1);
      }}
    />
  );
  const next = (
    <Button
      size="sm"
      startIcon={<Icon icon={ChevronRight} />}
      accessibilityLabel="Next page"
      disabled={page >= pageCount}
      onPress={() => {
        onPageChange(page + 1);
      }}
    />
  );
  return (
    <View
      {...({ role: 'navigation', 'aria-label': label } as object)}
      className={cn(
        'flex-row items-center',
        numbered ? 'flex-wrap gap-1' : 'justify-between gap-2',
        className,
      )}
    >
      {previous}
      {numbered ? (
        paginationRange(page, pageCount, siblings).map((item, index) =>
          item === ELLIPSIS ? (
            <Text
              key={`ellipsis-${String(index)}`}
              aria-hidden
              variant="subhead"
              weight="semibold"
              tone="subtle"
              className="min-w-10 text-center"
            >
              …
            </Text>
          ) : (
            // A page is a circle, 40 across, the current one filled: the
            // window has to fit a phone's width, where a button's padding
            // would wrap it.
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={`Page ${String(item)}`}
              accessibilityState={{ selected: item === page }}
              {...(item === page ? ({ 'aria-current': 'page' } as object) : {})}
              onPress={() => {
                onPageChange(item);
              }}
              className={cn(
                'h-10 min-w-10 items-center justify-center rounded-full px-1.5',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                item === page ? 'bg-invert' : 'active:bg-surface-sunken',
              )}
            >
              <Text
                variant="subhead"
                weight="semibold"
                tabular
                tone={item === page ? 'on-invert' : 'default'}
              >
                {String(item)}
              </Text>
            </Pressable>
          ),
        )
      ) : (
        <View accessibilityLiveRegion="polite" {...({ 'aria-live': 'polite' } as object)}>
          <Text variant="subhead" weight="medium" tone="muted" tabular>
            Page{' '}
            <Text variant="subhead" weight="semibold" tabular>
              {String(page)}
            </Text>{' '}
            of {String(pageCount)}
          </Text>
        </View>
      )}
      {next}
    </View>
  );
}

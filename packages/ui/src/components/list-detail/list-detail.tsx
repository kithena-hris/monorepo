'use client';

import { ChevronLeft } from 'lucide-react';
import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { useMediaQuery } from '../../lib/use-media-query';
import { Button } from '../button/button';

/**
 * Hierarchical navigation: a list, and the thing you picked from it.
 *
 * One component, two genuinely different interaction models, because the
 * device forces them to differ:
 *
 * - **Wide.** Both panes are visible. Selecting a row changes the right pane;
 *   the list keeps its scroll position and its filters. Nothing navigates.
 * - **Narrow.** There is only room for one, so the detail *replaces* the list
 *   and a back control returns to it. This is a push, and it has to behave
 *   like one.
 *
 * ### The parts that are usually wrong
 *
 * **Focus.** On the narrow path the visible content is replaced without a
 * route change, so nothing tells assistive tech that the page changed. Focus
 * is moved to the detail pane on open and back to the list on close, the
 * behaviour a real navigation would have given for free. Without it a screen
 * reader user selects a row and hears nothing at all.
 *
 * **The pane that is not visible.** It stays mounted, so scroll position,
 * virtualisation state and any in-flight edit survive the round trip. That is
 * the whole reason to use this instead of two routes. But mounted and hidden
 * is still reachable by Tab and by a screen reader unless it is marked
 * `inert`, which is the tabbing-into-invisible-content bug in most hand-rolled
 * versions of this layout.
 */

export interface ListDetailProps extends ComponentPropsWithoutRef<'div'> {
  list: ReactNode;
  /** The detail pane. `null` shows `emptyDetail` at wide sizes. */
  detail?: ReactNode;
  /** Shown in the detail pane at wide sizes when nothing is selected. */
  emptyDetail?: ReactNode;
  /** Whether something is selected. Drives the narrow-screen push. */
  selected?: boolean;
  /** Called by the back control. Required for the narrow path to be escapable. */
  onBack?: () => void;
  backLabel?: string;
  /** Width of the list pane at wide sizes. */
  listWidth?: string;
  /** The width at which both panes fit. */
  splitFrom?: 'md' | 'lg' | 'xl';
  /** Accessible names for the two regions. */
  listLabel?: string;
  detailLabel?: string;
}

const splitClass = {
  md: 'md:grid md:grid-cols-[var(--list-width)_minmax(0,1fr)]',
  lg: 'lg:grid lg:grid-cols-[var(--list-width)_minmax(0,1fr)]',
  xl: 'xl:grid xl:grid-cols-[var(--list-width)_minmax(0,1fr)]',
} as const;

const borderClass = {
  md: 'md:border-e md:border-border',
  lg: 'lg:border-e lg:border-border',
  xl: 'xl:border-e xl:border-border',
} as const;

const hideBelowSplit = {
  md: 'max-md:hidden',
  lg: 'max-lg:hidden',
  xl: 'max-xl:hidden',
} as const;

/**
 * The same widths as the classes above, as media queries. Duplicating a number
 * is how a layout splits at 1024px in CSS and 1023px in JS, so both sides read
 * from one table.
 */
const splitQuery = {
  md: '(min-width: 48rem)',
  lg: '(min-width: 64rem)',
  xl: '(min-width: 80rem)',
} as const;

export function ListDetail({
  className,
  list,
  detail,
  emptyDetail,
  selected = false,
  onBack,
  backLabel = 'Back to the list',
  listWidth = '22rem',
  splitFrom = 'lg',
  listLabel = 'List',
  detailLabel = 'Details',
  ...props
}: ListDetailProps): JSX.Element {
  const detailRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previous = useRef(selected);

  const split = useMediaQuery(splitQuery[splitFrom]);
  // Only one pane is on screen below the split, so only there is anything
  // hidden, and only there does the selection amount to a navigation.
  const pushed = selected && !split;

  useEffect(() => {
    if (selected === previous.current) return;
    previous.current = selected;
    if (split) return;

    const target = selected ? detailRef.current : listRef.current;
    target?.focus({ preventScroll: true });
  }, [selected, split]);

  /*
   * React's `CSSProperties` has no index signature, so a custom property is not
   * assignable to it and the usual workaround is to assert the key into a
   * `string`. Declaring the property instead keeps the object checked: a typo
   * in the name is now an error, where the assertion would have accepted any
   * string at all, including the wrong one.
   */
  const style: CSSProperties & { '--list-width': string } = { '--list-width': listWidth };

  return (
    <div className={cn('min-h-0', splitClass[splitFrom], className)} style={style} {...props}>
      <div
        ref={listRef}
        tabIndex={-1}
        role="region"
        aria-label={listLabel}
        // `inert` only while the pane is genuinely off screen. Setting it
        // whenever something is selected would make a perfectly visible list
        // unfocusable at desk sizes.
        inert={pushed}
        className={cn(
          'min-w-0 focus-visible:outline-none',
          borderClass[splitFrom],
          selected && hideBelowSplit[splitFrom],
        )}
      >
        {list}
      </div>

      <div
        ref={detailRef}
        tabIndex={-1}
        role="region"
        aria-label={detailLabel}
        inert={!selected && !split}
        className={cn(
          'min-w-0 focus-visible:outline-none',
          !selected && hideBelowSplit[splitFrom],
          pushed && 'animate-slide-up',
        )}
      >
        {pushed && onBack ? (
          <div className="border-b border-border p-2">
            <Button variant="ghost" size="sm" startIcon={<ChevronLeft />} onClick={onBack}>
              {backLabel}
            </Button>
          </div>
        ) : null}
        {detail ?? emptyDetail}
      </div>
    </div>
  );
}

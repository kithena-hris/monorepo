'use client';

import { ChevronLeft } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';

import { cn } from '../../lib/cn';
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
  /**
   * The width *of this component* at which both panes fit: `md` 48rem, `lg`
   * 64rem, `xl` 80rem. A container width, not the viewport's.
   */
  splitFrom?: 'md' | 'lg' | 'xl';
  /** Accessible names for the two regions. */
  listLabel?: string;
  detailLabel?: string;
}

/*
 * Container queries, not viewport breakpoints.
 *
 * Whether two panes fit is a question about the space this component was
 * given, not about the window. A list-detail in a 390px phone preview on a wide
 * monitor, or in one card of a two-column dashboard, has to push even though
 * the viewport would happily split. The root is the container; the grid inside
 * it asks how wide that is.
 *
 * `@3xl`, `@5xl` and `@7xl` are 48, 64 and 80rem, the widths the `md`, `lg`
 * and `xl` names always meant, so a caller's `splitFrom` keeps its meaning.
 */
const splitClass = {
  md: '@3xl:grid @3xl:grid-cols-[var(--list-width)_minmax(0,1fr)]',
  lg: '@5xl:grid @5xl:grid-cols-[var(--list-width)_minmax(0,1fr)]',
  xl: '@7xl:grid @7xl:grid-cols-[var(--list-width)_minmax(0,1fr)]',
} as const;

const borderClass = {
  md: '@3xl:border-e @3xl:border-border',
  lg: '@5xl:border-e @5xl:border-border',
  xl: '@7xl:border-e @7xl:border-border',
} as const;

const hideBelowSplit = {
  md: '@max-3xl:hidden',
  lg: '@max-5xl:hidden',
  xl: '@max-7xl:hidden',
} as const;

/**
 * Whether the grid is currently split, read from the grid itself.
 *
 * The focus and `inert` logic needs the answer in JS. Measuring a width here
 * and comparing it with a number would be a second copy of the threshold, which
 * is how a layout splits at 1024px in CSS and 1023px in JS. Asking the grid
 * whether it *is* a grid has one source of truth, the classes above. The
 * observer watches the container, whose width is what changes the answer.
 */
function useSplit(
  container: RefObject<HTMLDivElement | null>,
  grid: RefObject<HTMLDivElement | null>,
): boolean {
  const [split, setSplit] = useState(false);
  useLayoutEffect(() => {
    const root = container.current;
    const el = grid.current;
    if (!root || !el) return;
    const read = (): void => {
      setSplit(getComputedStyle(el).display === 'grid');
    };
    read();
    // jsdom has no observer. The first reading stands, which is all a test needs.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [container, grid]);
  return split;
}

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
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const previous = useRef(selected);

  const split = useSplit(rootRef, gridRef);
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
    // The outer element is the query container and takes the caller's props. An
    // element cannot query its own width, so the grid is one level down.
    <div ref={rootRef} className={cn('@container min-h-0', className)} style={style} {...props}>
      <div ref={gridRef} className={cn('h-full min-h-0', splitClass[splitFrom])}>
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
    </div>
  );
}

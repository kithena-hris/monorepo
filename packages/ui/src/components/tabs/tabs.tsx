'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * Peer views of the same subject.
 *
 * Tabs are not navigation and not a wizard. If the panels have an order the
 * user must follow, use a stepper; if they are separate pages, use routes so
 * the URL survives a refresh.
 */
export const Tabs = TabsPrimitive.Root;

/** Where the active marker currently sits, in the list's own coordinates. */
interface IndicatorRect {
  left: number;
  width: number;
}

export interface TabsListProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /**
   * `line` underlines the active tab and is the default: the views of one
   * subject. `pill` fills it, for a second row of views inside a line-tabbed
   * area, or a filter strip on a phone. Two rows of line tabs stacked on each
   * other read as one broken row.
   */
  variant?: 'line' | 'pill';
}

export function TabsList({
  className,
  children,
  variant = 'line',
  ...props
}: TabsListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<IndicatorRect | null>(null);

  /*
   * One marker that travels, rather than a border that appears on the new tab
   * and vanishes from the old one.
   *
   * A marker that jumps makes the user find it again; one that slides carries
   * their eye from the tab they left to the tab they chose, and the direction it
   * travels tells them which way through the set they just moved. It is the
   * cheapest available way to say "these are peers in a row" rather than "here
   * are some unrelated buttons, one of which is lit".
   *
   * It has to be measured, because the marker spans the active tab and tab
   * labels are words of different lengths. CSS has no way to ask how wide a
   * sibling is.
   */
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!active) {
      setRect(null);
      return;
    }

    /*
     * `offsetLeft`/`offsetWidth`, not `getBoundingClientRect`. The list is the
     * positioned ancestor, so these are already in its coordinate space and,
     * unlike a client rect, they do not change when a narrow tab strip is
     * scrolled sideways, which would otherwise drag the marker off its tab.
     */
    setRect((previous) =>
      previous && previous.left === active.offsetLeft && previous.width === active.offsetWidth
        ? previous
        : { left: active.offsetLeft, width: active.offsetWidth },
    );
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    measure();

    /*
     * Three things move the marker, and each needs its own observer.
     *
     * The active tab changes: Radix flips `data-state` on two triggers, which is
     * an attribute mutation and not something React re-renders this component
     * for, since the triggers are opaque children.
     *
     * The tabs change size: a late-loading webfont re-measures every label, and
     * a count badge arriving widens one tab. Without this the marker keeps the
     * width the label had before the font swapped.
     *
     * Tabs are added or removed, which `childList` catches.
     */
    const mutations = new MutationObserver(measure);
    mutations.observe(list, {
      attributes: true,
      attributeFilter: ['data-state'],
      childList: true,
      subtree: true,
    });

    const resizes = new ResizeObserver(measure);
    resizes.observe(list);
    for (const tab of list.querySelectorAll('[role="tab"]')) resizes.observe(tab);

    return () => {
      mutations.disconnect();
      resizes.disconnect();
    };
  }, [measure]);

  return (
    <TabsPrimitive.List
      ref={listRef}
      // `group/tabs` so a trigger can ask whether the measured marker is live
      // yet, and `data-indicator` is that answer.
      data-indicator={rect ? 'ready' : undefined}
      // Read by the triggers, so a `TabsTrigger` needs no prop of its own.
      data-variant={variant}
      className={cn(
        'group/tabs relative flex items-center',
        variant === 'line'
          ? 'gap-1 border-b border-border touch:gap-0'
          : // Room above and below for each pill's tap-target hit area, which
            // the strip's own scrolling would otherwise clip.
            'gap-1.5 touch:py-1',
        /*
         * The strip scrolls sideways rather than overflowing the page.
         *
         * Three ordinary tabs — "Overview", "Employees (12)", "Sign-in page" —
         * measure wider than a 390px phone, and without this the whole document
         * scrolled horizontally to accommodate them. A tab strip is the one
         * navigation control that is allowed to be wider than its container, so
         * long as it carries its own scroll; the page is not.
         *
         * `pb-px` is what makes that safe. `overflow-x` clips at the padding
         * box, and both the marker and each trigger's own underline sit one
         * pixel below the content — the padding gives them that pixel back.
         * `overscroll-contain` stops a swipe that runs off the end of the strip
         * from turning into a back-navigation gesture.
         */
        'overflow-x-auto overscroll-x-contain pb-px',
        className,
      )}
      {...props}
    >
      {children}
      {/*
       * Decorative. The active tab is already announced by `aria-selected` on
       * the trigger, so a screen reader gains nothing from this and would only
       * have to skip past it.
       *
       * Rendered even before the first measurement, at zero opacity, so the
       * element is in the DOM and its first move is a transition rather than an
       * appearance.
       */}
      <span
        aria-hidden="true"
        data-slot="tabs-indicator"
        className={cn(
          // `bottom-0`, not `-bottom-px`: the list clips at its padding box, so
          // a marker positioned outside it disappears the moment the strip
          // becomes scrollable. It sits on the border rather than over it,
          // which at one pixel is the same picture.
          //
          // The span is the tab's full width; the bar inside it is inset by
          // the tab's padding, so it underlines the label, not the hit area.
          'pointer-events-none absolute bottom-0 left-0 flex h-[3px] px-3',
          // Only the line variant has a marker to travel.
          variant === 'pill' && 'hidden',
          // Only `transform` and `width` animate. `left` would relayout the
          // strip on every frame; a translate stays on the compositor.
          'transition-[transform,width,opacity] duration-(--animate-duration-spring-move)',
          'ease-spring-move',
          rect ? 'opacity-100' : 'opacity-0',
        )}
        style={
          rect
            ? { transform: `translateX(${rect.left.toFixed(2)}px)`, width: rect.width }
            : undefined
        }
      >
        <span className="flex-1 rounded-t-[3px] bg-accent" />
      </span>
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>): JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative inline-flex items-center justify-center gap-2 text-sm font-semibold',
        // `shrink-0` so a strip that does not fit scrolls instead of squeezing
        // every label into the same cramped column.
        'shrink-0 whitespace-nowrap text-fg-muted',
        'transition-colors duration-(--animate-duration-fast) ease-standard',
        'hover:text-fg data-[state=active]:text-fg',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        'disabled:pointer-events-none disabled:text-fg-disabled',
        '[&_svg]:size-4',

        /*
         * Line. On a phone the tabs share the width equally, the way a
         * segmented row of peers does; `shrink-0` still wins once they no
         * longer fit, so a long set scrolls rather than squeezing.
         */
        'group-data-[variant=line]/tabs:-mb-px group-data-[variant=line]/tabs:h-11 group-data-[variant=line]/tabs:px-3',
        'touch:group-data-[variant=line]/tabs:h-12 touch:group-data-[variant=line]/tabs:flex-1 touch:min-w-tap',
        /*
         * Each trigger still draws its own underline, and then gives it up the
         * moment the list reports a measured marker.
         *
         * That ordering is the point. The marker cannot be positioned until
         * layout exists, so a version that relied on it alone would render one
         * frame with no active tab at all, and would show nothing whatsoever if
         * JavaScript failed. This way the static border is the floor and the
         * travelling marker is the enhancement on top of it.
         */
        'group-data-[variant=line]/tabs:border-b-[3px] group-data-[variant=line]/tabs:border-transparent',
        'group-data-[variant=line]/tabs:data-[state=active]:border-accent',
        'group-data-[indicator=ready]/tabs:data-[state=active]:border-transparent',

        // Pill. The active view is the inverted surface, the rest sit on a fill.
        'group-data-[variant=pill]/tabs:h-8 group-data-[variant=pill]/tabs:rounded-control group-data-[variant=pill]/tabs:px-3.5',
        // 36px drawn, the tap floor hit: a 44px pill reads as a button.
        'touch:group-data-[variant=pill]/tabs:h-9 group-data-[variant=pill]/tabs:tap-target',
        'group-data-[variant=pill]/tabs:bg-surface-sunken group-data-[variant=pill]/tabs:hover:bg-surface-hover',
        'group-data-[variant=pill]/tabs:data-[state=active]:bg-invert group-data-[variant=pill]/tabs:data-[state=active]:text-fg-on-invert',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>): JSX.Element {
  return (
    <TabsPrimitive.Content
      className={cn(
        'pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'data-[state=active]:animate-fade-in',
        className,
      )}
      {...props}
    />
  );
}

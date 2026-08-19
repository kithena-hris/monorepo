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

export function TabsList({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>): JSX.Element {
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
      className={cn(
        'group/tabs relative flex items-center gap-1 border-b border-border',
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
          'pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full bg-accent',
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
      />
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
        'relative -mb-px inline-flex items-center gap-2 px-3 py-2 text-base font-medium',
        'text-fg-muted whitespace-nowrap',
        'border-b-2 border-transparent',
        'transition-colors duration-(--animate-duration-fast) ease-standard',
        'hover:text-fg',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        'data-[state=active]:text-fg',
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
        'data-[state=active]:border-accent',
        'group-data-[indicator=ready]/tabs:data-[state=active]:border-transparent',
        'disabled:pointer-events-none disabled:text-fg-disabled',
        '[&_svg]:size-4',
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

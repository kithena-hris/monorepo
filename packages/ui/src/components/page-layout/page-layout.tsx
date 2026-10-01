'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import {
  ChevronsLeft,
  ChevronsRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { PINNED_BAR } from '../../lib/pinned';
import { cn } from '../../lib/cn';
import { Kbd } from '../kbd/kbd';
import { Tooltip } from '../tooltip/tooltip';

/**
 * Page skeletons, as named slots.
 *
 * Every screen in an HRIS is one of about five shapes. Written by hand, each of
 * those five gets re-derived per module with slightly different sticky
 * behaviour, slightly different scroll containers and a different answer to
 * "where does the safe-area padding go", and the product stops feeling like
 * one product. This is the one place those answers live.
 *
 * The slots are props rather than children with magic `displayName` matching:
 * a slot that is a prop is type-checked, cannot be nested in the wrong place,
 * and cannot be silently dropped when someone wraps it in a fragment.
 *
 * ### What the layout guarantees
 *
 * - Exactly one scroll container. `main`. A page with two scrollbars is a
 *   page where the user cannot find the bottom.
 * - `header` and `bottomBar` are sticky and do not scroll away.
 * - Safe-area insets are applied where each edge actually needs them.
 * - Landmarks: one `<header>`, one `<nav>`, one `<main>`, one
 *   `<aside>` and one `<footer>`, so a screen-reader user can jump between
 *   them. That is the part that is easiest to get wrong by hand and the part
 *   nobody notices is missing.
 */

/*
 * Five rows, and every slot says which one it is in.
 *
 * It was four, with `header`, `banner`, `footer` and `bottomBar` relying on
 * implicit placement — which works only while a header and a banner are both
 * present to fill rows one and two. A layout with neither, which is every
 * screen in the tenant app, put the bottom bar in row one: a mobile tab bar
 * pinned to the top of the page, `sticky bottom-0` and all.
 *
 * Explicit rows cost nothing and cannot be arranged wrongly by an absent
 * sibling.
 */
const layout = cva('grid min-h-dvh bg-canvas', {
  variants: {
    preset: {
      /** Header over content. Settings, a wizard, a detail page. */
      stacked: 'grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] grid-cols-1',
      /** Navigation rail beside content. The default application shell. */
      sidebar:
        'grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] grid-cols-1 @min-[40rem]/page:grid-cols-[auto_minmax(0,1fr)]',
      /** Navigation, content, and a detail rail. Three panes at desk sizes. */
      'sidebar-aside':
        'grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] grid-cols-1 @min-[40rem]/page:grid-cols-[auto_minmax(0,1fr)] @7xl/page:grid-cols-[auto_minmax(0,1fr)_auto]',
      /** No navigation at all: onboarding, a signature flow, a modal page. */
      focused: 'grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] grid-cols-1',
      /** Content fills the viewport and manages its own scrolling, a Kanban board, a calendar. */
      canvas: 'grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] grid-cols-1 overflow-hidden',
    },
  },
  defaultVariants: { preset: 'stacked' },
});

/**
 * Whether a rail can be put away, and what is left when it is.
 *
 * A discriminated union like the rest of this system's configuration: a
 * `collapsed` value has no meaning without a collapse mode, and a controlled
 * panel with no change handler is a button that does nothing.
 */
export type PageRailCollapse =
  | { mode: 'none' }
  /**
   * Collapses to an icon rail. The right choice for primary navigation.
   * Destinations stay reachable and stay in the same order, so the muscle
   * memory survives.
   *
   * Uncontrolled and with no `defaultCollapsed`, it starts collapsed when the
   * layout is narrower than 1024px (its container, not the window) and
   * nothing is remembered. `storageKey` remembers the choice in this browser,
   * per device, which is where the choice was made.
   */
  | {
      mode: 'rail';
      collapsed?: boolean;
      defaultCollapsed?: boolean;
      onCollapsedChange?: (collapsed: boolean) => void;
      storageKey?: string;
    }
  /**
   * Collapses to nothing, with a control to bring it back. For a detail rail,
   * where half-visible content is worse than none.
   */
  | {
      mode: 'hidden';
      collapsed?: boolean;
      defaultCollapsed?: boolean;
      onCollapsedChange?: (collapsed: boolean) => void;
    };

interface RailState {
  collapsed: boolean;
}

/** The collapsed rail's width, and the width a drag has to pass to open it. */
export const RAIL_WIDTH_PX = 76;
export const RAIL_SNAP_PX = 160;
/** Below this layout width a rail with nothing remembered starts collapsed. */
const RAIL_AUTO_COLLAPSE_PX = 1024;
/** Labels fade first, then the width eases: the two phases of the motion. */
const RAIL_FADE_MS = 120;
const RAIL_WIDTH_MS = 240;

/**
 * Where a drag of the rail's edge leaves it: the width under the pointer,
 * held between the rail and the expanded sidebar, and whether that is
 * collapsed. Wider than 160px is open; back under it snaps shut.
 */
export function railDrag(
  startWidth: number,
  delta: number,
  maxWidth: number,
): { readonly width: number; readonly collapsed: boolean } {
  const width = Math.min(
    Math.max(startWidth + delta, RAIL_WIDTH_PX),
    Math.max(maxWidth, RAIL_WIDTH_PX),
  );
  return { width, collapsed: width <= RAIL_SNAP_PX };
}

/** A remembered choice, or `null`: private windows throw, and a server has no storage. */
function remembered(key: string | undefined): boolean | null {
  if (key === undefined) return null;
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : value === 'collapsed';
  } catch {
    return null;
  }
}

function remember(key: string | undefined, collapsed: boolean): void {
  if (key === undefined) return;
  try {
    localStorage.setItem(key, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* not remembered, still applied */
  }
}

function reducedMotion(): boolean {
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Published so navigation inside the rail can render itself as icons without
 * every screen threading a `collapsed` prop through four components. Defaults
 * to expanded, so a `Nav` used anywhere else behaves normally.
 */
export const RailContext = createContext<RailState>({ collapsed: false });

/** True when the surrounding rail is collapsed to icons. */
export function useRailCollapsed(): boolean {
  return useContext(RailContext).collapsed;
}

/**
 * Controlled-or-not, in one hook. The pattern appears twice here and would
 * otherwise be copied, which is how the two rails end up behaving differently.
 *
 * A rail moves in two phases: collapsing, its labels fade (120ms) and then the
 * width eases (240ms); expanding, the width eases and then the labels fade in.
 * `fading` is the phase with the labels out. Under reduced motion, or when a
 * drag is already moving it, it switches at once.
 */
function useCollapse(
  config: PageRailCollapse,
  container?: RefObject<HTMLElement | null>,
): {
  enabled: boolean;
  collapsed: boolean;
  fading: boolean;
  /** False until the starting state is settled: nothing animates into it. */
  settled: boolean;
  toggle: () => void;
  set: (next: boolean, animate?: boolean) => void;
} {
  const controlled = config.mode !== 'none' ? config.collapsed : undefined;
  const [internal, setInternal] = useState(
    config.mode !== 'none' ? (config.defaultCollapsed ?? false) : false,
  );
  const [fading, setFading] = useState(false);
  const [settled, setSettled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsed = controlled ?? internal;
  const storageKey = config.mode === 'rail' ? config.storageKey : undefined;

  /*
   * Before the first paint, so a remembered rail never flashes open: what
   * this device remembers, or else collapsed when the layout is narrow. Once,
   * on mount; after that the person decides.
   */
  const auto = config.mode === 'rail' && config.defaultCollapsed === undefined;
  useLayoutEffect(() => {
    if (controlled !== undefined) return;
    const stored = remembered(storageKey);
    if (stored !== null) setInternal(stored);
    else if (auto && (container?.current?.clientWidth ?? Infinity) < RAIL_AUTO_COLLAPSE_PX) {
      setInternal(true);
    }
  }, []);

  // After the layout effect has settled where it starts, so it does not ease there.
  useEffect(() => {
    setSettled(true);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const set = useCallback(
    (next: boolean, animate = true) => {
      if (config.mode === 'none' || next === collapsed) return;
      const commit = (): void => {
        if (config.collapsed === undefined) setInternal(next);
        remember(config.mode === 'rail' ? config.storageKey : undefined, next);
        config.onCollapsedChange?.(next);
      };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (!animate || config.mode !== 'rail' || reducedMotion()) {
        setFading(false);
        commit();
        return;
      }
      setFading(true);
      if (next) {
        // The labels go first, then the width.
        timer.current = setTimeout(() => {
          commit();
          setFading(false);
        }, RAIL_FADE_MS);
      } else {
        // The width first, then the labels come back into the room it made.
        commit();
        timer.current = setTimeout(() => {
          setFading(false);
        }, RAIL_WIDTH_MS);
      }
    },
    [collapsed, config],
  );

  const toggle = useCallback(() => {
    set(!collapsed);
  }, [collapsed, set]);

  return { enabled: config.mode !== 'none', collapsed, fading, settled, toggle, set };
}

export interface PageLayoutProps
  extends ComponentPropsWithoutRef<'div'>, VariantProps<typeof layout> {
  /** Sticky top bar. Rendered as the page's `<header>` landmark. */
  header?: ReactNode;
  /** Full-width strip under the header: an outage notice, an impersonation warning. */
  banner?: ReactNode;
  /** Primary navigation. Rendered as `<nav>`; hidden while the layout is narrower than 40rem (`@min-[40rem]/page`), a container width rather than the viewport: pair it with `bottomBar` or a `Sheet`. */
  sidebar?: ReactNode;
  /**
   * Pinned to the top of the sidebar, sharing its row with the collapse
   * control.
   *
   * A product mark, a workspace switcher, a company's name. It exists because
   * the collapse control used to occupy a strip of its own above the sidebar
   * slot — about 40px of empty chrome that a caller could not put anything in,
   * and which read as the sidebar starting some way down the page. Anything
   * passed here now shares that row, so the space is used rather than reserved.
   *
   * It does not scroll with the navigation below it, and it stays visible when
   * the rail is collapsed: keep what survives at 3.5rem to a mark.
   */
  sidebarHeader?: ReactNode;
  /** Secondary rail: activity, help, a detail summary. Rendered as `<aside>`; hidden while the layout is narrower than 80rem (`@7xl/page`). */
  aside?: ReactNode;
  /** Status strip at the bottom of the page flow. Rendered as `<footer>`. */
  footer?: ReactNode;
  /** Fixed bottom bar: mobile tabs, a sticky form action row. Padded for the home indicator. */
  bottomBar?: ReactNode;
  /** Whether the sidebar can be put away, and what is left when it is. */
  sidebarCollapse?: PageRailCollapse;
  /** Whether the aside can be put away. */
  asideCollapse?: PageRailCollapse;
  /**
   * Keyboard shortcut for the sidebar, with the platform modifier. `null`
   * disables it. `\\` rather than `b`: ⌘B is bold in every text field, and a
   * layout-wide binding must not take it from a rich-text editor.
   */
  sidebarShortcut?: string | null;
  /** Classes for the scrolling `<main>`. Padding belongs here. */
  contentClassName?: string;
  /**
   * Classes for the bottom bar's own wrapper, which carries the border and the
   * sticky positioning.
   *
   * `@min-[40rem]/page:hidden` is what a mobile tab bar wants (the width the sidebar appears at), and it has to go here rather
   * than on the content: hiding only the content leaves the wrapper behind as a
   * one-pixel bordered strip across the bottom of every desktop page. Reach's
   * own shell story had exactly that.
   */
  bottomBarClassName?: string;
  /**
   * `bar` is a strip across the bottom edge: a form's action row. `floating`
   * is a glass pill that the page scrolls under, the shape a phone's tab bar
   * takes.
   */
  bottomBarVariant?: 'bar' | 'floating';
  /** Accessible name for the `<main>` landmark when a page has more than one region worth naming. */
  contentLabel?: string;
}

export function PageLayout({
  className,
  contentClassName,
  bottomBarClassName,
  bottomBarVariant = 'bar',
  contentLabel,
  preset,
  header,
  banner,
  sidebar,
  sidebarHeader,
  aside,
  footer,
  bottomBar,
  sidebarCollapse = { mode: 'none' },
  asideCollapse = { mode: 'none' },
  sidebarShortcut = '\\',
  children,
  ...props
}: PageLayoutProps): JSX.Element {
  const hasSidebar = Boolean(sidebar) && preset !== 'stacked' && preset !== 'focused';
  const hasAside = Boolean(aside) && preset === 'sidebar-aside';

  const sidebarId = useId();
  const asideId = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const nav = useRef<HTMLElement | null>(null);
  const sidebarState = useCollapse(sidebarCollapse, container);
  const asideState = useCollapse(asideCollapse);

  /*
   * The modifier is the platform's, matching `Kbd`: a shortcut printed as ⌘B
   * and bound to Ctrl+B is a shortcut that looks broken on a Mac. `event.key`
   * rather than `code`, so a Dvorak or AZERTY layout gets the letter it is
   * actually looking at.
   */
  useEffect(() => {
    if (!sidebarState.enabled || sidebarShortcut === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== sidebarShortcut.toLowerCase()) return;
      event.preventDefault();
      sidebarState.toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sidebarShortcut, sidebarState]);

  return (
    /*
     * The query container, and nothing else.
     *
     * Whether the rails fit is a question about the width this layout was
     * given, not about the window: a shell rendered inside a 390px phone
     * preview on a wide monitor, or inside a panel, must drop its sidebar
     * exactly as it would on the phone. An element cannot query its own width,
     * so the grid sits one level down and every rail asks `@…/page`. Named, so
     * a caller who makes the grid a container of its own does not capture the
     * question.
     */
    <div ref={container} className="@container/page">
      <div className={cn('relative', layout({ preset }), className)} {...props}>
        {header ? (
          <header
            // `col-span-full` rather than a grid area: the header spans every
            // column at every breakpoint, including the ones where the sidebar
            // column does not exist.
            //
            // Structural chrome, so it takes the heavier weight: this bar
            // separates a region of the app rather than drawing attention to a
            // control, and a thicker material is what reads as "the app frame".
            // The attribute is what `prefers-reduced-transparency` and
            // `prefers-contrast` key off in base.css, translucency is a setting a
            // user can decline and a class name cannot be queried.
            data-material="chrome"
            className={cn(
              'sticky top-0 z-30 row-start-1 col-span-full border-b border-glass-line bg-surface',
              'backdrop-blur-material backdrop-saturate-(--reach-material-saturate)',
              'pt-safe-top ps-safe-left pe-safe-right',
              // Supports-backdrop-filter, because a solid fallback is better
              // than a translucent bar over unreadable text on a browser that
              // ignores the blur. `glass` is the one tint every material in the
              // system shares, so the top bar and the tab bar are one substance.
              'supports-[backdrop-filter]:bg-glass',
            )}
          >
            {header}
          </header>
        ) : null}

        {banner ? <div className="row-start-2 col-span-full">{banner}</div> : null}

        {hasSidebar ? (
          <nav
            ref={nav}
            id={sidebarId}
            aria-label="Main"
            data-collapsed={sidebarState.collapsed || undefined}
            data-fading={sidebarState.fading || undefined}
            className={cn(
              'group/sidebar relative row-start-3 hidden shrink-0 border-e border-border bg-surface',
              // Above the content, so a flyout from one of its items (`NavItem`'s
              // `flyout`) paints over the page rather than under a sticky toolbar.
              '@min-[40rem]/page:z-30',
              /*
               * A flex column, not a block.
               *
               * The rail toggle below is a sibling *above* the caller's sidebar,
               * so in a block container a sidebar asking for `h-full` gets the
               * nav's whole height and then sits under a 32px toggle — 32px
               * taller than the column it lives in. The visible symptom is a
               * sidebar that scrolls as one piece and takes whatever is pinned to
               * its bottom, usually the profile and sign-out, below the fold.
               *
               * As a flex column the toggle takes its own height and the sidebar
               * slot takes the rest, so `h-full` inside it means what a caller
               * expects.
               */
              '@min-[40rem]/page:flex @min-[40rem]/page:flex-col',
              'ps-safe-left',
              // Sticky under the header: a 40-item navigation must not push the
              // page taller than the content.
              //
              // The offset is the header's height, and only when there is one.
              // It was 3.5rem unconditionally, so a layout with no header
              // reserved a header's worth of space it never filled — the
              // sidebar stuck 56px down the page and stopped 56px short of the
              // bottom.
              '@min-[40rem]/page:sticky @min-[40rem]/page:overscroll-contain',
              header
                ? '@min-[40rem]/page:top-14 @min-[40rem]/page:max-h-[calc(100dvh-3.5rem)]'
                : '@min-[40rem]/page:top-0 @min-[40rem]/page:max-h-dvh',
              // The width eases rather than snapping, after the labels have
              // gone (`useCollapse`); a drag moves it directly.
              sidebarState.enabled &&
                sidebarState.settled &&
                'transition-[width] duration-[240ms] ease-standard motion-reduce:transition-none data-dragging:transition-none',
              // What a rail fades before its width moves, and brings back after.
              '[&_[data-rail-label]]:transition-opacity [&_[data-rail-label]]:duration-[120ms] motion-reduce:[&_[data-rail-label]]:transition-none',
              'data-fading:[&_[data-rail-label]]:opacity-0',
              sidebarState.enabled &&
                sidebarCollapse.mode === 'rail' &&
                sidebarState.collapsed &&
                '@min-[40rem]/page:w-19',
              sidebarState.enabled &&
                sidebarCollapse.mode === 'hidden' &&
                sidebarState.collapsed &&
                '@min-[40rem]/page:w-0 @min-[40rem]/page:border-e-0',
            )}
            // Only when nothing is left to interact with. A collapsed *rail*
            // still holds every destination, so making it inert would remove
            // navigation the user can plainly see.
            inert={sidebarCollapse.mode === 'hidden' && sidebarState.collapsed ? true : undefined}
          >
            <RailContext value={{ collapsed: sidebarState.collapsed }}>
              {/*
                The column, and its own scroll container. `overflow-x-hidden`
                matters as much as the duration: without it the labels spill
                across the content while the width moves. It is here rather
                than on the nav so the edge handle can stand across the border.
              */}
              <div className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden">
                {/*
                One row, holding whatever the caller pinned at the top and the
                collapse control at its end.

                Rendered whenever either exists, so a sidebar with no header is
                unchanged and one with a header no longer pays for a strip of
                chrome above it.
              */}
                {(sidebarHeader ??
                (sidebarState.enabled &&
                  !(sidebarCollapse.mode === 'hidden' && sidebarState.collapsed))) ? (
                  // The brand at the eye's starting point with the collapse
                  // button beside it. As a rail the two stack, the expand button
                  // directly under the mark: the control never moves.
                  <div className="bg-surface sticky top-0 z-10 flex items-center gap-2 px-5 pt-4.5 pb-2 group-data-[collapsed]/sidebar:flex-col group-data-[collapsed]/sidebar:gap-1 group-data-[collapsed]/sidebar:px-2 group-data-[collapsed]/sidebar:pb-3">
                    <div className="flex min-h-8 min-w-0 flex-1 items-center group-data-[collapsed]/sidebar:justify-center">
                      {sidebarHeader}
                    </div>
                    {sidebarState.enabled &&
                    !(sidebarCollapse.mode === 'hidden' && sidebarState.collapsed) ? (
                      <RailToggle
                        side="start"
                        controls={sidebarId}
                        collapsed={sidebarState.collapsed}
                        onToggle={sidebarState.toggle}
                        label="sidebar"
                        shortcut={sidebarShortcut}
                        className="shrink-0"
                      />
                    ) : null}
                  </div>
                ) : null}
                {/*
                `min-h-0` so this can be shorter than its content and let the
                caller scroll a region inside it, rather than growing the column
                and pushing anything pinned to the bottom out of reach.
              */}
                <div className="min-h-0 flex-1">{sidebar}</div>
              </div>
            </RailContext>
            {sidebarCollapse.mode === 'rail' ? (
              <RailEdge nav={nav} collapsed={sidebarState.collapsed} onSet={sidebarState.set} />
            ) : null}
          </nav>
        ) : null}

        <main
          aria-label={contentLabel}
          className={cn(
            'row-start-3 min-w-0',
            /*
             * `clip`, not `auto`, outside the canvas preset. The grid sizes this
             * row to its content, so the window is what scrolls; `overflow-y-auto`
             * made this element a scroll container that never scrolled, and a
             * `sticky bottom-0` inside it — a form's Save, kept above a phone's
             * keyboard — stuck to the bottom of the content instead of the
             * screen. `overflow-x: clip` still keeps a wide child from pushing
             * the page sideways, and creates no scroll container.
             */
            preset === 'canvas' ? 'overflow-hidden' : 'overflow-x-clip',
            /*
             * Smooth only where smoothness is ours to give.
             *
             * `scroll-behavior` governs *programmatic* scrolling — an anchor, a
             * `scrollIntoView`, a "back to top" — and nothing else. A wheel, a
             * trackpad and a finger are already smooth, and are the browser's to
             * animate; a script that intercepts them is how an app ends up with
             * scrolling that fights the hardware and ignores the platform's
             * momentum curve. So this is a property, not a library.
             *
             * Not inherited, so it stays on this scroller and does not reach the
             * listbox inside a `Combobox`, where a keyboard user arrowing down a
             * long list wants the option under the cursor *now*.
             *
             * `base.css` forces it back to `auto` under `prefers-reduced-motion`,
             * which is why there is no `motion-safe:` here.
             *
             * The padding is the sticky header's height, so an anchored target
             * lands below the header rather than under it.
             */
            'scroll-smooth',
            header ? 'scroll-pt-14' : null,
            !hasSidebar && 'col-span-full',
            contentClassName,
          )}
        >
          {children}
        </main>

        {hasAside ? (
          <aside
            id={asideId}
            aria-label="Details"
            data-collapsed={asideState.collapsed || undefined}
            className={cn(
              'row-start-3 hidden shrink-0 border-s border-border bg-surface @7xl/page:block',
              'pe-safe-right',
              '@7xl/page:sticky @7xl/page:top-14 @7xl/page:max-h-[calc(100dvh-3.5rem)] @7xl/page:overflow-y-auto @7xl/page:overscroll-contain',
              asideState.enabled &&
                'overflow-x-hidden transition-[width] duration-(--animate-duration-normal) ease-standard motion-reduce:transition-none',
              asideState.enabled &&
                asideCollapse.mode === 'rail' &&
                asideState.collapsed &&
                '@7xl/page:w-14',
              asideState.enabled &&
                asideCollapse.mode === 'hidden' &&
                asideState.collapsed &&
                '@7xl/page:w-0 @7xl/page:border-s-0',
            )}
            inert={asideCollapse.mode === 'hidden' && asideState.collapsed ? true : undefined}
          >
            <RailContext value={{ collapsed: asideState.collapsed }}>
              {asideState.enabled && !(asideCollapse.mode === 'hidden' && asideState.collapsed) ? (
                <RailToggle
                  side="end"
                  controls={asideId}
                  collapsed={asideState.collapsed}
                  onToggle={asideState.toggle}
                  label="details"
                  shortcut={null}
                  className="sticky top-0 z-10 flex justify-start p-2 pb-0"
                />
              ) : null}
              {aside}
            </RailContext>
          </aside>
        ) : null}

        {/*
         * A panel that collapses to zero width takes any control inside it with
         * it, and then the only way back is a keyboard shortcut nobody was told
         * about. So the reopen control for `hidden` mode is pinned to the layout
         * edge: absolutely positioned, which keeps it out of the grid and stops
         * it creating a column of its own.
         */}
        {hasSidebar && sidebarCollapse.mode === 'hidden' && sidebarState.collapsed ? (
          <RailToggle
            side="start"
            controls={sidebarId}
            collapsed
            onToggle={sidebarState.toggle}
            label="navigation"
            shortcut={sidebarShortcut}
            className="absolute top-16 start-2 z-30 hidden @min-[40rem]/page:block"
          />
        ) : null}

        {hasAside && asideCollapse.mode === 'hidden' && asideState.collapsed ? (
          <RailToggle
            side="end"
            controls={asideId}
            collapsed
            onToggle={asideState.toggle}
            label="details"
            shortcut={null}
            className="absolute top-16 end-2 z-30 hidden @7xl/page:block"
          />
        ) : null}

        {footer ? (
          <footer className="row-start-4 col-span-full border-t border-border bg-surface pb-safe-bottom">
            {footer}
          </footer>
        ) : null}

        {bottomBar ? (
          <div
            {...PINNED_BAR}
            data-material={bottomBarVariant === 'floating' ? 'chrome' : undefined}
            className={cn(
              'sticky bottom-0 z-30 row-start-5 col-span-full',
              bottomBarVariant === 'bar'
                ? 'border-t border-border bg-surface pb-safe-bottom ps-safe-left pe-safe-right'
                : [
                    /*
                     * A pill floating over the content rather than a strip across
                     * the bottom of it. The page scrolls *under* it, which is the
                     * reason for the glass: the content is still there, just
                     * behind the bar, instead of ending at a hard edge 64px short
                     * of the screen.
                     *
                     * The margin, not padding, carries the home indicator, so the
                     * pill sits above it rather than stretching down behind it.
                     */
                    'mx-2.5 mb-[max(0.75rem,env(safe-area-inset-bottom))] rounded-full p-1',
                    'border border-glass-line bg-surface shadow-md supports-[backdrop-filter]:bg-glass',
                    'backdrop-blur-material backdrop-saturate-(--reach-material-saturate)',
                  ],
              bottomBarClassName,
            )}
          >
            {bottomBar}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The control that puts a rail away and brings it back.
 *
 * `aria-expanded` and `aria-controls`, so the relationship is announced rather
 * than implied by the icon; the accessible name says which rail and which
 * direction, because "Toggle" is not a name.
 *
 * The sidebar's is a quiet button beside the brand, where the eye starts, and
 * in the rail it sits directly under the mark: the same spot, so the control
 * never moves. Its tooltip carries the shortcut.
 */
function RailToggle({
  side,
  controls,
  collapsed,
  onToggle,
  label,
  shortcut,
  className,
}: {
  side: 'start' | 'end';
  controls: string;
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  shortcut: string | null;
  className?: string;
}): JSX.Element {
  const name =
    side === 'start'
      ? `${collapsed ? 'Expand' : 'Collapse'} ${label}`
      : `${collapsed ? 'Show' : 'Hide'} ${label}`;
  const Icon =
    side === 'start'
      ? collapsed
        ? PanelLeftOpen
        : PanelLeftClose
      : collapsed
        ? PanelRightOpen
        : PanelRightClose;

  return (
    <div className={cn('pointer-events-none relative z-20', className)}>
      <Tooltip
        content={name}
        shortcut={
          shortcut ? (
            <>
              <Kbd keyName="mod" />
              <Kbd>{shortcut.toUpperCase()}</Kbd>
            </>
          ) : undefined
        }
        side={side === 'start' ? 'right' : 'left'}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={controls}
          aria-label={name}
          aria-keyshortcuts={shortcut ? `Meta+${shortcut} Control+${shortcut}` : undefined}
          onClick={onToggle}
          className={cn(
            'tap-target relative pointer-events-auto grid place-items-center rounded-[0.625rem]',
            'text-fg-muted transition-[color,background-color,transform] duration-(--animate-duration-fast) ease-standard',
            'hover:bg-surface-hover hover:text-fg active:scale-95',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            // Always visible.
            //
            // It used to fade in on `group-hover/layout`, on the argument that
            // a permanent chevron is noise on a screen nobody is collapsing.
            // The cost was worse than the noise: a control nobody can see is a
            // control nobody knows exists, and the reveal made it flicker —
            // anything that suppressed `:hover` on the layout for a moment,
            // such as a modal layer disabling pointer events on the body, blinked
            // it out and back with every pointer move.
            //
            // In the rail, a wider target under the mark; beside the brand, a
            // control's height.
            side === 'start' && collapsed ? 'h-9 w-11 [&_svg]:size-4.5' : 'size-8 [&_svg]:size-4',
          )}
        >
          <Icon aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * The rail's edge, for a pointer: hover it and a handle stands across the
 * border. A click toggles; a drag moves the edge with the pointer, open past
 * 160px and shut again under it, and lets go at the nearer of the two.
 *
 * `aria-hidden` and out of the tab order: the toggle button is the keyboard's
 * way, and this is only a larger target for the same thing.
 */
function RailEdge({
  nav,
  collapsed,
  onSet,
}: {
  nav: RefObject<HTMLElement | null>;
  collapsed: boolean;
  onSet: (collapsed: boolean, animate?: boolean) => void;
}): JSX.Element {
  // The width it opens to, measured while open, for how far a drag may pull it.
  const open = useRef(248);
  const drag = useRef<{
    x: number;
    width: number;
    dir: 1 | -1;
    moved: boolean;
    collapsed: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const element = nav.current;
    if (!collapsed && element !== null && element.offsetWidth > RAIL_SNAP_PX) {
      open.current = element.offsetWidth;
    }
  });

  const end = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const state = drag.current;
    drag.current = null;
    const element = nav.current;
    if (state === null || element === null) return;
    element.removeAttribute('data-dragging');
    // Back to the width the state says; the transition eases it the rest of the way.
    element.style.width = '';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!state.moved && !cancelled) onSet(!state.collapsed);
  };

  return (
    <div
      aria-hidden
      className={cn(
        'group/edge absolute inset-y-0 -end-1.5 z-40 w-3 cursor-col-resize touch-none select-none',
      )}
      onPointerDown={(event) => {
        const element = nav.current;
        if (event.button !== 0 || element === null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          width: element.offsetWidth,
          dir: getComputedStyle(element).direction === 'rtl' ? -1 : 1,
          moved: false,
          collapsed,
        };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        const element = nav.current;
        if (state === null || element === null) return;
        const delta = (event.clientX - state.x) * state.dir;
        // A click wobbles; four pixels is a drag.
        if (!state.moved && Math.abs(delta) < 4) return;
        state.moved = true;
        element.setAttribute('data-dragging', '');
        const next = railDrag(state.width, delta, open.current);
        element.style.width = `${String(next.width)}px`;
        // Open or shut as the edge crosses the line, with no phases: the
        // pointer is already moving it.
        if (next.collapsed !== state.collapsed) {
          state.collapsed = next.collapsed;
          onSet(next.collapsed, false);
        }
      }}
      onPointerUp={(event) => {
        end(event, false);
      }}
      onPointerCancel={(event) => {
        end(event, true);
      }}
    >
      {/* The border, lit. */}
      <span className="absolute inset-y-0 start-1 w-1 rounded-full bg-accent opacity-0 transition-opacity duration-(--animate-duration-fast) group-hover/edge:opacity-100" />
      <Tooltip
        content={collapsed ? 'Click or drag to expand' : 'Click or drag to collapse'}
        side="right"
      >
        <span className="absolute top-1/2 -start-1.5 grid h-13 w-7 -translate-y-1/2 place-items-center rounded-full bg-surface-raised text-accent-fg opacity-0 shadow-md ring-2 ring-accent transition-opacity duration-(--animate-duration-fast) group-hover/edge:opacity-100 [&_svg]:size-[15px] rtl:[&_svg]:rotate-180">
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
        </span>
      </Tooltip>
    </div>
  );
}

interface PageHeaderFrameValue {
  readonly breadcrumb?: ReactNode;
  readonly actions?: ReactNode;
  /**
   * Under a finger the frame's breadcrumb is a phone's navigation bar whose
   * small title names the page, so the large title under it would say the
   * same thing twice: `true` keeps it for a screen reader only.
   */
  readonly quietTitleOnTouch?: boolean;
  /**
   * The page's tabs, when the frame knows them: a `TertiaryNav` of links
   * (`orientation="horizontal"`), each tab its own URL. A header that draws
   * its own `tabs` keeps them.
   */
  readonly tabs?: ReactNode;
  /**
   * Under a finger, the frame's `actions` go up into the phone's navigation
   * bar, the top-right slot of its `breadcrumb`, rather than into a row under
   * the title. Make them icon buttons there, each named with `aria-label`.
   */
  readonly touchBarActions?: boolean;
}

const PageHeaderFrameContext = createContext<PageHeaderFrameValue>({});

/**
 * What a frame put around the page: its breadcrumb, actions and tabs. For a screen
 * whose header is not a plain `PageHeader` (a record with its photo beside
 * the title) and has to place the trail itself.
 */
export function usePageHeaderFrame(): PageHeaderFrameValue {
  return useContext(PageHeaderFrameContext);
}

export interface PageHeaderFrameProps extends PageHeaderFrameValue {
  readonly children?: ReactNode;
}

/**
 * What a frame around a page adds to that page's header, when the frame does
 * not render the page itself.
 *
 * A host that draws its chrome around a screen it only mounts would otherwise
 * put its breadcrumb and its actions in a row of their own above the screen's
 * header, and the page would open with two headers. Under this, every
 * `PageHeader` shows the frame's `breadcrumb` when it has none of its own, and
 * the frame's `actions` after its own — so a frame's primary action lands at
 * the trailing edge, where a primary action goes. Its `tabs` go under the
 * header the same way, when the header has none of its own.
 */
export function PageHeaderFrame({
  breadcrumb,
  actions,
  quietTitleOnTouch = false,
  tabs,
  touchBarActions = false,
  children,
}: PageHeaderFrameProps): JSX.Element {
  return (
    <PageHeaderFrameContext
      value={{ breadcrumb, actions, quietTitleOnTouch, tabs, touchBarActions }}
    >
      {children}
    </PageHeaderFrameContext>
  );
}

export interface PageHeaderProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** A `Breadcrumb`, above the title. */
  breadcrumb?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Status badges or counts, beside the title. */
  meta?: ReactNode;
  /** Primary and secondary actions. Collapses to full width below `sm`. */
  actions?: ReactNode;
  /** A `TabsList`, or a horizontal `TertiaryNav` of links, flush with the bottom edge. */
  tabs?: ReactNode;
  /** Renders the title one step smaller, for a panel or a sheet. */
  size?: 'md' | 'lg';
  /**
   * Under a finger, these `actions` go up into the phone's navigation bar,
   * top right, rather than into a row under the title: an account avatar, an
   * icon button. With no breadcrumb the header opens with that bar. Make them
   * icon-sized there. At a desk nothing moves.
   */
  touchBarActions?: boolean;
}

/**
 * The standard page opening: where am I, what is this, what can I do here.
 *
 * `title` renders an `<h1>`. A page with no `h1`, or with three, is the single
 * most common heading-structure failure, and it is what a screen-reader user
 * lands on first.
 */
export function PageHeader({
  className,
  breadcrumb,
  title,
  description,
  meta,
  actions,
  tabs,
  size = 'lg',
  touchBarActions = false,
  ...props
}: PageHeaderProps): JSX.Element {
  const frame = useContext(PageHeaderFrameContext);
  const trail = breadcrumb ?? frame.breadcrumb;
  const own = actions ?? null;
  const framed = frame.actions ?? null;
  /*
   * What goes up into a phone's bar, and what stays in the row. The bar is
   * `display: contents` at a desk, so the order and the row are unchanged
   * there; under a finger it is positioned in the bar's right slot.
   *
   * Important under a finger, for the reason `TertiaryNav`'s pills give: a
   * remote's later stylesheet may define the desk classes again.
   */
  const liftOwn = touchBarActions && own !== null;
  const liftFrame = frame.touchBarActions === true && framed !== null;
  const bar = liftOwn || liftFrame;
  const barClass = cn(
    'contents @max-md:[&>*]:flex-1',
    'touch:absolute! touch:end-0 touch:flex! touch:h-12 touch:items-center touch:gap-2 touch:[&>*]:flex-none!',
    trail ? 'touch:-top-1' : 'touch:top-0',
  );
  const rowEmptyOnTouch = (liftOwn || own === null) && (liftFrame || framed === null);
  const allActions =
    own === null && framed === null ? null : (
      <>
        {liftOwn && liftFrame ? (
          <div className={barClass}>
            {own}
            {framed}
          </div>
        ) : (
          <>
            {liftOwn ? <div className={barClass}>{own}</div> : own}
            {liftFrame ? <div className={barClass}>{framed}</div> : framed}
          </>
        )}
      </>
    );
  return (
    // A container, so the actions go full width when the header is narrow
    // rather than when the window is: a header in a phone frame, a sheet or a
    // side panel is narrow on any monitor.
    <div
      className={cn(
        '@container flex flex-col gap-3',
        // The bar the lifted actions sit in: the breadcrumb's, or one of their own.
        bar && 'touch:relative',
        bar && !trail && 'touch:pt-12',
        className,
      )}
      {...props}
    >
      {trail}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              // The display face, heavy and tracked in: under a finger `lg` is
              // the large title a phone opens a screen with.
              className={cn(
                'min-w-0 font-display font-bold tracking-tight text-fg',
                size === 'lg' ? 'text-2xl' : 'text-lg',
                // Only when the frame's own trail is drawn: a page that places the
                // trail itself (a record beside its photo) keeps its title.
                frame.quietTitleOnTouch === true && breadcrumb === undefined && 'touch:sr-only',
              )}
            >
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            // A measure, not a width: past ~65 characters the eye loses the
            // start of the next line.
            <p className="mt-1.5 max-w-prose text-base text-pretty text-fg-muted">{description}</p>
          ) : null}
        </div>
        {allActions ? (
          <div
            className={cn(
              'flex shrink-0 flex-wrap items-center gap-2 @max-md:w-full @max-md:[&>*]:flex-1',
              // Nothing left in the row under a finger: no empty row either.
              rowEmptyOnTouch && 'touch:contents!',
            )}
          >
            {allActions}
          </div>
        ) : null}
      </div>
      {tabs ?? frame.tabs}
    </div>
  );
}

export interface PageSectionProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Renders the section inside a `Card`-like surface. */
  surface?: boolean;
}

/**
 * A titled block within a page. The heading is an `<h2>`, so the document
 * outline is a real outline rather than a sequence of styled divs.
 */
export function PageSection({
  className,
  title,
  description,
  actions,
  surface = false,
  children,
  ...props
}: PageSectionProps): JSX.Element {
  return (
    <section
      className={cn(
        'min-w-0',
        // A fill and a soft shadow rather than a ruled box, and a little
        // tighter under a finger, where the phone's own margin is already 16px.
        surface && 'rounded-lg bg-surface p-5 shadow-sm touch:p-4',
        className,
      )}
      {...props}
    >
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-display text-md font-bold tracking-tight text-fg touch:text-lg">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 max-w-prose text-sm text-pretty text-fg-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface ToolbarProps extends ComponentPropsWithoutRef<'div'> {
  /** Search or the primary filter. Takes the remaining width. */
  search?: ReactNode;
  /** Filter controls. Wrap; they are the first thing to overflow. */
  filters?: ReactNode;
  /** View switches, export, column chooser. Pinned to the trailing edge. */
  actions?: ReactNode;
  /** Selection bar, revealed above the toolbar when rows are selected. */
  selection?: ReactNode;
  /** Sticks under the page header while a long table scrolls. */
  sticky?: boolean;
}

/**
 * The strip above a table.
 *
 * `role="toolbar"` is deliberately *not* set. That role implies a single tab
 * stop with arrow-key navigation between items, which is right for a
 * formatting toolbar of icon buttons and wrong here, a search field inside a
 * roving-tabindex toolbar swallows the arrow keys the user needs for text.
 */
export function Toolbar({
  className,
  search,
  filters,
  actions,
  selection,
  sticky = false,
  children,
  ...props
}: ToolbarProps): JSX.Element {
  return (
    <div
      // Thin, and only when sticky. A toolbar floating under the header is the
      // second translucent layer down; giving it the same weight as the header
      // would stack two materials, which is the one thing that reliably
      // destroys legibility rather than merely looking busy.
      data-material={sticky ? 'thin' : undefined}
      className={cn(
        'flex flex-col gap-2',
        sticky &&
          'sticky top-14 z-20 -mx-4 bg-canvas/95 px-4 py-2 backdrop-blur-material-thin sm:-mx-6 sm:px-6',
        className,
      )}
      {...props}
    >
      {selection}
      <div className="flex flex-wrap items-center gap-2">
        {search ? <div className="min-w-48 flex-1 max-sm:w-full">{search}</div> : null}
        {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
        {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
        {children}
      </div>
    </div>
  );
}

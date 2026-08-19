'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
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

const layout = cva('grid min-h-dvh bg-canvas', {
  variants: {
    preset: {
      /** Header over content. Settings, a wizard, a detail page. */
      stacked: 'grid-rows-[auto_auto_minmax(0,1fr)_auto] grid-cols-1',
      /** Navigation rail beside content. The default application shell. */
      sidebar:
        'grid-rows-[auto_auto_minmax(0,1fr)_auto] grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)]',
      /** Navigation, content, and a detail rail. Three panes at desk sizes. */
      'sidebar-aside':
        'grid-rows-[auto_auto_minmax(0,1fr)_auto] grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_auto]',
      /** No navigation at all: onboarding, a signature flow, a modal page. */
      focused: 'grid-rows-[auto_auto_minmax(0,1fr)_auto] grid-cols-1',
      /** Content fills the viewport and manages its own scrolling, a Kanban board, a calendar. */
      canvas: 'grid-rows-[auto_auto_minmax(0,1fr)_auto] grid-cols-1 overflow-hidden',
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
   */
  | {
      mode: 'rail';
      collapsed?: boolean;
      defaultCollapsed?: boolean;
      onCollapsedChange?: (collapsed: boolean) => void;
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

/**
 * Published so navigation inside the rail can render itself as icons without
 * every screen threading a `collapsed` prop through four components. Defaults
 * to expanded, so a `Nav` used anywhere else behaves normally.
 */
const RailContext = createContext<RailState>({ collapsed: false });

/** True when the surrounding rail is collapsed to icons. */
export function useRailCollapsed(): boolean {
  return useContext(RailContext).collapsed;
}

/**
 * Controlled-or-not, in one hook. The pattern appears twice here and would
 * otherwise be copied, which is how the two rails end up behaving differently.
 */
function useCollapse(config: PageRailCollapse): {
  enabled: boolean;
  collapsed: boolean;
  toggle: () => void;
} {
  const controlled = config.mode !== 'none' ? config.collapsed : undefined;
  const [internal, setInternal] = useState(
    config.mode !== 'none' ? (config.defaultCollapsed ?? false) : false,
  );
  const collapsed = controlled ?? internal;

  const toggle = useCallback(() => {
    if (config.mode === 'none') return;
    const next = !collapsed;
    if (config.collapsed === undefined) setInternal(next);
    config.onCollapsedChange?.(next);
  }, [collapsed, config]);

  return { enabled: config.mode !== 'none', collapsed, toggle };
}

export interface PageLayoutProps
  extends ComponentPropsWithoutRef<'div'>, VariantProps<typeof layout> {
  /** Sticky top bar. Rendered as the page's `<header>` landmark. */
  header?: ReactNode;
  /** Full-width strip under the header: an outage notice, an impersonation warning. */
  banner?: ReactNode;
  /** Primary navigation. Rendered as `<nav>`; hidden below `md`: pair it with `bottomBar` or a `Sheet`. */
  sidebar?: ReactNode;
  /** Secondary rail: activity, help, a detail summary. Rendered as `<aside>`; hidden below `xl`. */
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
   * disables it. `b` is the convention every editor and every issue tracker
   * has settled on, which is the only reason to prefer it.
   */
  sidebarShortcut?: string | null;
  /** Classes for the scrolling `<main>`. Padding belongs here. */
  contentClassName?: string;
  /** Accessible name for the `<main>` landmark when a page has more than one region worth naming. */
  contentLabel?: string;
}

export function PageLayout({
  className,
  contentClassName,
  contentLabel,
  preset,
  header,
  banner,
  sidebar,
  aside,
  footer,
  bottomBar,
  sidebarCollapse = { mode: 'none' },
  asideCollapse = { mode: 'none' },
  sidebarShortcut = 'b',
  children,
  ...props
}: PageLayoutProps): JSX.Element {
  const hasSidebar = Boolean(sidebar) && preset !== 'stacked' && preset !== 'focused';
  const hasAside = Boolean(aside) && preset === 'sidebar-aside';

  const sidebarId = useId();
  const asideId = useId();
  const sidebarState = useCollapse(sidebarCollapse);
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
    <div className={cn('group/layout relative', layout({ preset }), className)} {...props}>
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
            'sticky top-0 z-30 col-span-full border-b border-border bg-surface/95',
            'backdrop-blur-material backdrop-saturate-(--reach-material-saturate)',
            'pt-safe-top ps-safe-left pe-safe-right',
            // Supports-backdrop-filter, because a solid fallback is better
            // than a translucent bar over unreadable text on a browser that
            // ignores the blur.
            'supports-[backdrop-filter]:bg-surface/80',
          )}
        >
          {header}
        </header>
      ) : null}

      {banner ? <div className="col-span-full">{banner}</div> : null}

      {hasSidebar ? (
        <nav
          id={sidebarId}
          aria-label="Main"
          data-collapsed={sidebarState.collapsed || undefined}
          className={cn(
            'group/sidebar relative row-start-3 hidden shrink-0 border-e border-border bg-surface md:block',
            'ps-safe-left',
            // Its own scroll container, sticky under the header: a 40-item
            // navigation must not push the page taller than the content.
            'md:sticky md:top-14 md:max-h-[calc(100dvh-3.5rem)] md:overflow-y-auto md:overscroll-contain',
            // The width animates rather than snapping. `overflow-x-hidden`
            // matters as much as the duration: without it the labels spill
            // across the content for the length of the transition.
            sidebarState.enabled &&
              'overflow-x-hidden transition-[width] duration-(--animate-duration-normal) ease-standard motion-reduce:transition-none',
            sidebarState.enabled &&
              sidebarCollapse.mode === 'rail' &&
              sidebarState.collapsed &&
              'md:w-14',
            sidebarState.enabled &&
              sidebarCollapse.mode === 'hidden' &&
              sidebarState.collapsed &&
              'md:w-0 md:border-e-0',
          )}
          // Only when nothing is left to interact with. A collapsed *rail*
          // still holds every destination, so making it inert would remove
          // navigation the user can plainly see.
          inert={sidebarCollapse.mode === 'hidden' && sidebarState.collapsed ? true : undefined}
        >
          <RailContext value={{ collapsed: sidebarState.collapsed }}>
            {sidebarState.enabled &&
            !(sidebarCollapse.mode === 'hidden' && sidebarState.collapsed) ? (
              <RailToggle
                side="start"
                controls={sidebarId}
                collapsed={sidebarState.collapsed}
                onToggle={sidebarState.toggle}
                label="navigation"
                shortcut={sidebarShortcut}
                className="sticky top-0 z-10 flex justify-end p-2 pb-0"
              />
            ) : null}
            {sidebar}
          </RailContext>
        </nav>
      ) : null}

      <main
        aria-label={contentLabel}
        className={cn(
          'row-start-3 min-w-0',
          preset === 'canvas' ? 'overflow-hidden' : 'overflow-y-auto',
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
            'row-start-3 hidden shrink-0 border-s border-border bg-surface xl:block',
            'pe-safe-right',
            'xl:sticky xl:top-14 xl:max-h-[calc(100dvh-3.5rem)] xl:overflow-y-auto xl:overscroll-contain',
            asideState.enabled &&
              'overflow-x-hidden transition-[width] duration-(--animate-duration-normal) ease-standard motion-reduce:transition-none',
            asideState.enabled &&
              asideCollapse.mode === 'rail' &&
              asideState.collapsed &&
              'xl:w-14',
            asideState.enabled &&
              asideCollapse.mode === 'hidden' &&
              asideState.collapsed &&
              'xl:w-0 xl:border-s-0',
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
          className="absolute top-16 start-2 z-30 hidden md:block"
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
          className="absolute top-16 end-2 z-30 hidden xl:block"
        />
      ) : null}

      {footer ? (
        <footer className="col-span-full border-t border-border bg-surface pb-safe-bottom">
          {footer}
        </footer>
      ) : null}

      {bottomBar ? (
        <div
          className={cn(
            'sticky bottom-0 z-30 col-span-full border-t border-border bg-surface',
            'pb-safe-bottom ps-safe-left pe-safe-right',
          )}
        >
          {bottomBar}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The control that puts a rail away and brings it back.
 *
 * `aria-expanded` and `aria-controls`, so the relationship is announced rather
 * than implied by the icon; the accessible name says which rail and which
 * direction, because "Toggle" is not a name.
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
  const action = collapsed ? 'Show' : 'Hide';
  const name = `${action} ${label}`;
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
        content={
          shortcut ? (
            <span className="flex items-center gap-1.5">
              {name}
              <span className="font-sans text-2xs opacity-80">⌘{shortcut.toUpperCase()}</span>
            </span>
          ) : (
            name
          )
        }
        side={side === 'start' ? 'right' : 'left'}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={controls}
          aria-label={name}
          onClick={onToggle}
          className={cn(
            'pointer-events-auto grid size-6 place-items-center rounded-full',
            'border border-border bg-surface text-fg-subtle shadow-sm',
            'transition-[color,background-color,opacity,transform] duration-(--animate-duration-fast) ease-standard',
            'hover:bg-surface-hover hover:text-fg active:scale-95',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            // Quiet until the pointer is in the layout, or until the panel is
            // already away, a permanent chevron on every edge is noise on a
            // screen nobody is collapsing. Always visible on touch, where
            // there is no hover to reveal it with.
            'opacity-0 focus-visible:opacity-100 group-hover/layout:opacity-100 touch:opacity-100',
            collapsed && 'opacity-100',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      </Tooltip>
    </div>
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
  /** A `TabsList`, flush with the bottom edge. */
  tabs?: ReactNode;
  /** Renders the title one step smaller, for a panel or a sheet. */
  size?: 'md' | 'lg';
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
  ...props
}: PageHeaderProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-3', className)} {...props}>
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              className={cn(
                'min-w-0 font-semibold text-fg',
                size === 'lg' ? 'text-2xl' : 'text-lg',
              )}
            >
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-xs:w-full max-xs:[&>*]:flex-1">
            {actions}
          </div>
        ) : null}
      </div>
      {tabs}
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
        surface && 'rounded-lg border border-border bg-surface p-4 sm:p-5',
        className,
      )}
      {...props}
    >
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? <h2 className="text-md font-semibold text-fg">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
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

'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import { ChevronLeft } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * The bars above and below the content.
 *
 * - **`AppBar`**: the top bar. At a desk it is the global header, a row of
 *   brand, search and account; under a finger it is the phone's navigation
 *   bar, a back button, a centred title and one or two actions.
 * - **`TabBar`**: the floating bar of top-level sections at the bottom of a
 *   phone, and of a narrow web window.
 * - **`NavRail`**: the same sections down the side, for a tablet or a laptop
 *   too narrow for the sidebar.
 *
 * ### The large title
 *
 * `largeTitle` puts the title under the bar, big, as the first thing on the
 * screen. As the content scrolls it passes under the bar, and at the moment it
 * is covered the bar turns to glass and shows the title small. The swap is
 * measured from where the title actually is, not from a scroll offset, so it
 * works in whatever scrolls: the window, a panel, a sheet.
 *
 * Positioning is the screen's: the top bar is `sticky` to its scroll
 * container, and the tab bar is placed wherever the app's shell puts it.
 */

export interface AppBarProps extends Omit<ComponentPropsWithoutRef<'header'>, 'title'> {
  title?: ReactNode;
  /** Start of the bar: an `AppBarBack`, a logo, a Cancel. */
  leading?: ReactNode;
  /** End of the bar: icon buttons, an avatar. */
  actions?: ReactNode;
  /** Shows the title large under the bar, collapsing into it on scroll. */
  largeTitle?: boolean;
  /**
   * `selection` washes the bar in the accent: a mode, with its own leading
   * Cancel, that the reader has to leave deliberately.
   */
  tone?: 'default' | 'selection';
  /**
   * The rest of the bar. At a desk it sits between the title and the actions,
   * where a global search goes; under a finger it drops to a row of its own,
   * under a large title if there is one.
   */
  children?: ReactNode;
}

export function AppBar({
  title,
  leading,
  actions,
  largeTitle = false,
  tone = 'default',
  className,
  children,
  ...props
}: AppBarProps): JSX.Element {
  const barRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = (): void => {
      const bar = barRef.current?.getBoundingClientRect();
      const mark = markRef.current?.getBoundingClientRect();
      if (!bar || !mark) return;
      // Covered once its bottom edge passes under the bar's. For a bar without
      // a large title the mark is an empty line under it, so this is simply
      // "has anything scrolled under the bar yet".
      setScrolled(mark.bottom < bar.bottom - 0.5);
    };
    update();
    // Capture, because `scroll` does not bubble and the container is unknown.
    document.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, []);

  const selection = tone === 'selection';
  const glass = scrolled && !selection;

  return (
    <>
      <header
        ref={barRef}
        data-scrolled={scrolled || undefined}
        {...(glass ? { 'data-material': 'chrome' } : {})}
        className={cn(
          'sticky top-0 z-20 border-b border-transparent',
          'transition-[background-color,border-color] duration-(--animate-duration-normal) ease-standard',
          selection ? 'bg-accent-subtle' : 'bg-canvas',
          glass &&
            'border-glass-line bg-glass backdrop-blur-material backdrop-saturate-(--reach-material-saturate)',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'flex min-h-14 flex-wrap items-center gap-x-3 px-4',
            'touch:min-h-12 touch:gap-x-2 touch:px-3',
          )}
        >
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 empty:hidden',
              // Equal flexible ends keep a phone's title centred on the
              // screen, not on the space the buttons happen to leave.
              'touch:flex! touch:min-w-0 touch:flex-1 touch:basis-0',
            )}
          >
            {leading}
          </div>

          {title ? (
            largeTitle ? (
              // The large title below is the heading. This copy is the same
              // words, shown once it has scrolled away.
              <span
                aria-hidden
                className={cn(
                  'min-w-0 truncate text-md font-semibold text-fg opacity-0',
                  'transition-opacity duration-(--animate-duration-normal)',
                  scrolled && 'opacity-100',
                  'touch:max-w-[60%] touch:shrink-0 touch:text-center',
                )}
              >
                {title}
              </span>
            ) : (
              <h1
                className={cn(
                  'min-w-0 truncate text-md font-semibold text-fg',
                  'touch:max-w-[60%] touch:shrink-0 touch:text-center',
                )}
              >
                {title}
              </h1>
            )
          ) : null}

          {children && !largeTitle ? (
            <div className="flex min-w-0 flex-1 items-center touch:order-last touch:basis-full touch:pb-3">
              {children}
            </div>
          ) : null}

          <div
            className={cn(
              'ms-auto flex shrink-0 items-center justify-end gap-1 empty:hidden',
              'touch:flex! touch:min-w-0 touch:flex-1 touch:basis-0',
            )}
          >
            {actions}
          </div>
        </div>
      </header>

      <div ref={markRef} className={cn(largeTitle && 'px-4 pt-1 pb-3.5')}>
        {largeTitle ? (
          <>
            <h1 className="font-display text-2xl font-bold text-fg">{title}</h1>
            {children ? <div className="mt-3">{children}</div> : null}
          </>
        ) : null}
      </div>
    </>
  );
}

export interface AppBarBackProps extends ComponentPropsWithoutRef<'button'> {
  /** Render the child, a link, as the control. The chevron is drawn inside it. */
  asChild?: boolean;
}

/** Back, with the name of where it goes: "‹ People". */
export function AppBarBack({
  asChild = false,
  className,
  children,
  ...props
}: AppBarBackProps): JSX.Element {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      type={asChild ? undefined : 'button'}
      className={cn(
        'tap-target relative -ms-1.5 inline-flex min-w-0 items-center gap-0.5 rounded-sm pe-1.5',
        'text-sm font-medium text-accent-fg touch:text-md touch:font-normal',
        'hover:underline hover:underline-offset-4',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        '[&_svg]:size-5 [&_svg]:shrink-0 touch:[&_svg]:size-6',
        className,
      )}
      {...props}
    >
      <ChevronLeft aria-hidden />
      <Slottable>{children}</Slottable>
    </Comp>
  );
}

export interface TabBarProps extends ComponentPropsWithoutRef<'nav'> {
  /** Names the landmark: "Main". */
  label: string;
}

/** The floating pill of top-level sections. Up to five `TabBarItem`s. */
export function TabBar({ label, className, children, ...props }: TabBarProps): JSX.Element {
  return (
    <nav
      aria-label={label}
      data-material="chrome"
      className={cn(
        'group/bar rounded-control border border-glass-line bg-glass p-1.5 shadow-md',
        'backdrop-blur-material backdrop-saturate-(--reach-material-saturate)',
        className,
      )}
      {...props}
    >
      <ul className="flex items-center">{children}</ul>
    </nav>
  );
}

export interface NavRailProps extends ComponentPropsWithoutRef<'nav'> {
  label: string;
  /** Above the items: the mark, a compose button. */
  header?: ReactNode;
}

/** The sections down the side, icon over label. Holds `TabBarItem`s. */
export function NavRail({
  label,
  header,
  className,
  children,
  ...props
}: NavRailProps): JSX.Element {
  return (
    <nav
      aria-label={label}
      data-orientation="vertical"
      className={cn(
        'group/bar flex w-20 flex-col items-center gap-2.5 border-e border-border bg-surface py-3.5',
        className,
      )}
      {...props}
    >
      {header}
      <ul className="flex flex-col items-center gap-2.5">{children}</ul>
    </nav>
  );
}

export interface TabBarItemProps extends Omit<ComponentPropsWithoutRef<'a'>, 'children'> {
  icon: ReactNode;
  label: string;
  current?: boolean;
  /** A count of things waiting: drawn on the icon, and read with the label. */
  count?: number;
  /** Render the child, a framework link, as the item. */
  asChild?: boolean;
  children?: ReactNode;
}

export function TabBarItem({
  icon,
  label,
  current = false,
  count,
  asChild = false,
  className,
  children,
  ...props
}: TabBarItemProps): JSX.Element {
  const Comp = asChild ? Slot : 'a';
  return (
    <li className="min-w-0 flex-1 group-data-[orientation=vertical]/bar:flex-none">
      <Comp
        aria-current={current ? 'page' : undefined}
        className={cn(
          'group/item relative flex h-13 flex-col items-center justify-center gap-1 rounded-control px-1',
          'text-2xs font-semibold text-fg-muted',
          'transition-[background-color,color] duration-(--animate-duration-fast) ease-standard',
          'hover:text-fg aria-[current=page]:bg-accent-subtle aria-[current=page]:text-accent-fg',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
          // In a rail only the icon is a pill; the label sits under it.
          'group-data-[orientation=vertical]/bar:h-auto group-data-[orientation=vertical]/bar:w-16',
          'group-data-[orientation=vertical]/bar:aria-[current=page]:bg-transparent',
          className,
        )}
        {...props}
      >
        <Slottable>{children}</Slottable>
        <span
          aria-hidden
          className={cn(
            'relative grid place-items-center [&_svg]:size-5',
            'group-data-[orientation=vertical]/bar:h-8 group-data-[orientation=vertical]/bar:w-14 group-data-[orientation=vertical]/bar:rounded-control',
            'group-data-[orientation=vertical]/bar:group-aria-[current=page]/item:bg-accent-subtle',
          )}
        >
          {icon}
          {count ? (
            <span className="absolute -top-1.5 start-[calc(50%+0.25rem)] grid h-4 min-w-4 place-items-center rounded-full bg-danger-solid px-1 text-2xs leading-none font-bold text-fg-on-solid ring-2 ring-surface tabular-nums">
              {count}
            </span>
          ) : null}
        </span>
        <span className="max-w-full truncate">
          {label}
          {count ? <span className="sr-only">, {count} new</span> : null}
        </span>
      </Comp>
    </li>
  );
}

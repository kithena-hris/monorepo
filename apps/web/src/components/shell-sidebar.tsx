'use client';

import { Nav, NavItem, NavList, Separator, icons } from '@reach/ui';
import type { Route } from 'next';
import { useEffect, useRef, type JSX, type ReactNode } from 'react';

import { Link } from '../lib/link';
import { t as tr } from '../lib/t';

/**
 * The sidebar is a rail (`PageLayout`'s `sidebarRail`, with no panel): the
 * company's areas as icons, fixed while the page scrolls. An area's sections
 * come out of its icon on hover, focus or a tap (`NavItem flyout`), over the
 * page rather than beside it, so the page keeps its whole width.
 *
 * Nothing scrolls and nothing is cut short: the rail holds one icon per area
 * (named by its tooltip), and a flyout only ever holds one area's sections,
 * whose names wrap rather than truncate. Shortcuts are not on the rows (the
 * rail's tooltips, the palette and the help sheet carry them).
 */

/** One of an area's sections, as the panel and the rail's flyout list it. */
export interface ShellSection {
  readonly path: string;
  readonly label: string;
  readonly icon?: JSX.Element | undefined;
  readonly badge?: JSX.Element | undefined;
  readonly current: boolean;
}

/** One area of the company, as the rail shows it and the panel opens it. */
export interface ShellArea {
  readonly key: string;
  readonly label: string;
  readonly icon: JSX.Element;
  /** Where a press goes: its first section, so a press is one round trip. */
  readonly href: string;
  readonly current: boolean;
  readonly badge?: JSX.Element | undefined;
  /** Its keys, for the rail's tooltip: never on a row. */
  readonly shortcut?: JSX.Element | undefined;
  readonly sections: readonly ShellSection[];
  /** Its settings, at its flyout's foot. */
  readonly settings?: { readonly path: string; readonly current: boolean } | undefined;
  /** What the area pins at its flyout's foot: Time Off's clock. */
  readonly foot?: ReactNode;
}

/** What the shell knows about a press: which item, so it can say it is on its way. */
export interface Presses {
  readonly pending: (path: string) => boolean;
  readonly press: (path: string) => void;
}

/**
 * Every page one press from the sidebar, fetched as the pointer moves in it or
 * the keyboard comes into it: by the time a press lands, its page is here.
 *
 * One page at a time, each when the browser is idle, so the page you are on
 * is never made to wait for the ones you might go to; and once per page per
 * half minute, the time a fetched page is kept. On movement rather than on
 * entering: a sidebar drawn under a resting pointer is not a hand reaching for it.
 */
export function useWarmSidebar(
  warm: (href: string) => void,
): (event: { currentTarget: Element }) => void {
  const warmed = useRef(new Map<string, number>());
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  useEffect(() => {
    const seen = warmed.current;
    const waiting = queue.current;
    return () => {
      seen.clear();
      waiting.length = 0;
    };
  }, []);
  const next = (): void => {
    const href = queue.current.shift();
    if (href === undefined) {
      running.current = false;
      return;
    }
    warm(href);
    const later = (): void => {
      next();
    };
    if (typeof window.requestIdleCallback === 'function')
      window.requestIdleCallback(later, { timeout: 1000 });
    else window.setTimeout(later, 150);
  };
  return (event) => {
    const nav = event.currentTarget.closest('nav') ?? event.currentTarget;
    const now = Date.now();
    for (const link of nav.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
      const href = link.getAttribute('href');
      if (href === null) continue;
      const last = warmed.current.get(href);
      if (last !== undefined && now - last < 30_000) continue;
      warmed.current.set(href, now);
      queue.current.push(href);
    }
    if (!running.current && queue.current.length > 0) {
      running.current = true;
      next();
    }
  };
}

/** The rail: search, the areas, then settings and you, pinned to the foot. */
export function SidebarRail({
  areas,
  settings,
  search,
  account,
  presses,
  onIntent,
}: {
  readonly areas: readonly ShellArea[];
  readonly settings: ShellArea;
  readonly search: { readonly onOpen: () => void; readonly shortcut?: JSX.Element | undefined };
  readonly account: ReactNode;
  readonly presses: Presses;
  readonly onIntent: (event: { currentTarget: Element }) => void;
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1" onPointerMove={onIntent} onFocus={onIntent}>
      <Nav label={tr('components.shell-sidebar.search', 'Search')}>
        <NavList>
          <NavItem asChild icon={<icons.search aria-hidden />} shortcut={search.shortcut}>
            <button type="button" onClick={search.onOpen}>
              {tr('components.shell-sidebar.search', 'Search')}
            </button>
          </NavItem>
        </NavList>
      </Nav>
      <Separator className="mx-2 my-1.5 w-auto" />
      <Nav label={tr('components.shell-sidebar.areas', 'Areas')} className="min-h-0 flex-1">
        <NavList className="gap-1">
          {areas.map((area) => (
            <RailItem key={area.key} area={area} presses={presses} />
          ))}
        </NavList>
      </Nav>
      <div className="flex shrink-0 flex-col gap-2 pt-2">
        <Nav label={tr('components.shell-sidebar.account', 'Account')}>
          <NavList>
            <RailItem area={settings} presses={presses} />
          </NavList>
        </Nav>
        {account}
      </div>
    </div>
  );
}

/**
 * One area in the rail: its icon, and its sections flying out from it. An
 * area with one page and nothing else is named by its tooltip instead.
 */
function RailItem({
  area,
  presses,
}: {
  readonly area: ShellArea;
  readonly presses: Presses;
}): JSX.Element {
  const flyout =
    area.sections.length > 1 || area.settings !== undefined || area.foot != null ? (
      <AreaSections area={area} presses={presses} />
    ) : undefined;
  return (
    <NavItem
      asChild
      icon={area.icon}
      current={area.current}
      pending={presses.pending(area.href)}
      shortcut={area.shortcut}
      // A short window keeps every area on screen rather than scrolling them.
      className="[@media(max-height:44rem)]:min-h-9"
      {...(area.badge === undefined ? {} : { badge: area.badge })}
      {...(flyout === undefined ? {} : { flyout, flyoutSize: 'sm' as const })}
    >
      <Link
        href={area.href}
        onClick={() => {
          presses.press(area.href);
        }}
      >
        {area.label}
      </Link>
    </NavItem>
  );
}

/** An area's sections, as rows: icon, name (wrapping, never cut), count. */
function SectionList({
  area,
  presses,
}: {
  readonly area: ShellArea;
  readonly presses: Presses;
}): JSX.Element {
  return (
    <NavList className="gap-0.5">
      {area.sections.map((s) => (
        <NavItem
          key={s.path}
          asChild
          level={2}
          wrap
          icon={s.icon}
          current={s.current}
          pending={presses.pending(s.path)}
          {...(s.badge === undefined ? {} : { badge: s.badge })}
        >
          <Link
            href={s.path as Route}
            onClick={() => {
              presses.press(s.path);
            }}
          >
            {s.label}
          </Link>
        </NavItem>
      ))}
    </NavList>
  );
}

/**
 * An area's flyout: its name, its sections, and at the foot its settings and
 * anything it pins (Time Off's clock).
 */
function AreaSections({
  area,
  presses,
}: {
  readonly area: ShellArea;
  readonly presses: Presses;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-2.5 pt-1.5 pb-2 text-md leading-tight font-semibold break-words text-fg">
        {area.label}
      </p>
      <Nav
        label={tr('components.shell-sidebar.area_sections', '{{area}} sections', {
          area: area.label,
        })}
      >
        <SectionList area={area} presses={presses} />
      </Nav>
      {area.settings === undefined && area.foot == null ? null : (
        <div className="mt-1 flex flex-col gap-3 border-t border-border pt-2">
          {area.settings === undefined ? null : (
            <Nav
              label={tr('components.shell-sidebar.area_settings', '{{area}} settings', {
                area: area.label,
              })}
            >
              <NavList>
                <NavItem
                  asChild
                  level={2}
                  wrap
                  icon={<icons.settings aria-hidden />}
                  current={area.settings.current}
                  pending={presses.pending(area.settings.path)}
                >
                  <Link
                    href={area.settings.path}
                    onClick={() => {
                      if (area.settings !== undefined) presses.press(area.settings.path);
                    }}
                  >
                    {tr('components.shell-sidebar.area_settings', '{{area}} settings', {
                      area: area.label,
                    })}
                  </Link>
                </NavItem>
              </NavList>
            </Nav>
          )}
          {area.foot}
        </div>
      )}
    </div>
  );
}

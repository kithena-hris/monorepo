'use client';

import { Nav, NavItem, NavList, Separator, icons, useSidebarPanel } from '@reach/ui';
import type { Route } from 'next';
import { useEffect, useRef, type JSX, type ReactNode } from 'react';

import { Link } from '../lib/link';
import { t as tr } from '../lib/t';

/**
 * The sidebar in two columns (`PageLayout`'s `sidebarRail`): a rail of the
 * company's areas that never moves, and beside it a panel of the current
 * area's sections. Where you are is the rail; what you can do there is the
 * panel. Collapsed, the panel goes and the rail stays, each area's sections a
 * flyout from its icon.
 *
 * Nothing scrolls and nothing is cut short: the rail holds one icon per area
 * (named by its tooltip), and the panel only ever holds one area's sections,
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
  /** Its settings, at the panel's foot. */
  readonly settings?: { readonly path: string; readonly current: boolean } | undefined;
}

/** What the shell knows about a press: which item, so it can say it is on its way. */
export interface Presses {
  readonly pending: (path: string) => boolean;
  readonly press: (path: string) => void;
}

/**
 * Every page one press from the sidebar, fetched as the pointer enters it or
 * the keyboard comes into it: by the time a press lands, its page is here.
 * Once per page per half minute, the time a fetched page is kept.
 */
export function useWarmSidebar(warm: (href: string) => void): (event: { currentTarget: Element }) => void {
  const warmed = useRef(new Map<string, number>());
  useEffect(() => {
    const seen = warmed.current;
    return () => {
      seen.clear();
    };
  }, []);
  return (event) => {
    const nav = event.currentTarget.closest('nav') ?? event.currentTarget;
    const now = Date.now();
    for (const link of nav.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
      const href = link.getAttribute('href');
      if (href === null) continue;
      const last = warmed.current.get(href);
      if (last !== undefined && now - last < 30_000) continue;
      warmed.current.set(href, now);
      warm(href);
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
    <div
      className="flex min-h-0 flex-1 flex-col gap-1"
      onPointerEnter={onIntent}
      onFocus={onIntent}
    >
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
 * One area in the rail: its icon, named by its tooltip while the panel is
 * open beside it (which lists its sections), its sections flying out from it
 * when the panel is put away.
 */
function RailItem({
  area,
  presses,
}: {
  readonly area: ShellArea;
  readonly presses: Presses;
}): JSX.Element {
  const panel = useSidebarPanel();
  const flyout =
    panel === false && area.sections.length > 1 ? (
      <Nav label={tr('components.shell-sidebar.area_sections', '{{area}} sections', { area: area.label })}>
        <p className="px-2.5 pt-1 pb-2 text-sm font-semibold">{area.label}</p>
        <SectionList area={area} presses={presses} />
      </Nav>
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
 * The panel beside the rail: the current area's name, its sections, and its
 * settings and anything an area pins (Time Off's clock) at the foot.
 */
export function SidebarPanel({
  area,
  foot,
  presses,
  onIntent,
}: {
  readonly area: ShellArea;
  readonly foot?: ReactNode;
  readonly presses: Presses;
  readonly onIntent: (event: { currentTarget: Element }) => void;
}): JSX.Element {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col px-3 pt-5 pb-3"
      onPointerEnter={onIntent}
      onFocus={onIntent}
    >
      <h2 className="px-2.5 pb-3 text-lg leading-tight font-semibold break-words text-fg">
        {area.label}
      </h2>
      <Nav
        label={tr('components.shell-sidebar.area_sections', '{{area}} sections', { area: area.label })}
      >
        <SectionList area={area} presses={presses} />
      </Nav>
      <div className="mt-auto flex flex-col gap-3 pt-4">
        {area.settings === undefined ? null : (
          <Nav label={tr('components.shell-sidebar.area_settings', '{{area}} settings', { area: area.label })}>
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
        {foot}
      </div>
    </div>
  );
}

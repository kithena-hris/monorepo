'use client';

import {
  Nav,
  NavGroup,
  NavItem,
  NavList,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  icons,
  type IconName,
} from '@reach/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { currentPlace, type Place } from '../lib/remotes';

export { currentPlace };

/**
 * People's own navigation: the sections the People remote's manifest offers,
 * already cut to what this viewer's roles open (`placesFor`).
 *
 * The shell draws it rather than the remote. The remote says which places
 * exist; the host decides what its chrome looks like — so a host that sells
 * People on its own draws its own. Every link is a Next `Link`, so moving
 * between sections never reloads the page.
 *
 * - `PeopleSections`, the list itself, which the shell hangs off the People
 *   item in its sidebar as a flyout (`NavItem`'s `flyout`). It is there on
 *   hover, focus or a tap, and the screen keeps the full width otherwise.
 * - `PeopleBar`, above the screen on a phone only.
 *
 * The breadcrumb and the actions are not here: they join the screen's own
 * header (`headerFrame`), so a People page opens with one header.
 */
export interface PeopleNavProps {
  readonly sections: readonly Place[];
  /** The manifest route this screen matched, as written there: `/people/:id`. */
  readonly route: string | null;
}

function groupsOf(sections: readonly Place[]): [string, Place[]][] {
  const groups = new Map<string, Place[]>();
  for (const s of sections) {
    const group = s.group ?? 'People';
    groups.set(group, [...(groups.get(group) ?? []), s]);
  }
  return [...groups];
}

/** A manifest's icon name as a Reach icon; an unknown name draws nothing rather than failing. */
function iconOf(name: string | undefined): JSX.Element | undefined {
  if (name === undefined || !(name in icons)) return undefined;
  const Icon = icons[name as IconName];
  return <Icon />;
}

/**
 * The sections, grouped in columns, each with its icon and what it is for,
 * the current one marked: the sidebar's People flyout, a menu of the area
 * rather than a bare list.
 */
export function PeopleSections({ sections, route }: PeopleNavProps): JSX.Element | null {
  if (sections.length === 0) return null;
  const current = currentPlace(sections, route);
  return (
    <Nav label="People sections">
      <NavList columns={3}>
        {groupsOf(sections).map(([group, places]) => (
          <NavGroup key={group} label={group}>
            {places.map((s) => (
              <NavItem
                key={s.path}
                asChild
                level={2}
                current={s === current}
                icon={iconOf(s.icon)}
                description={s.description}
              >
                <Link href={s.path as Route}>{s.label}</Link>
              </NavItem>
            ))}
          </NavGroup>
        ))}
      </NavList>
    </Nav>
  );
}

/**
 * Where you are in People on a phone, which has no sidebar: a select that is
 * also the way to move. Everywhere else the screen's own header carries the
 * breadcrumb and the actions (`headerFrame`), so this row is a phone's only —
 * which is CSS; nothing here asks how wide the window is.
 */
export function PeopleBar({ sections, route }: PeopleNavProps): JSX.Element | null {
  const router = useRouter();
  if (sections.length === 0) return null;
  const current = currentPlace(sections, route);

  return (
    <div className="md:hidden">
      <Select
        value={current?.path ?? ''}
        onValueChange={(path) => {
          router.push(path);
        }}
      >
        <SelectTrigger aria-label="People section" className="w-full">
          <SelectValue placeholder="Go to a People section" />
        </SelectTrigger>
        <SelectContent>
          {groupsOf(sections).map(([group, places]) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {places.map((s) => (
                <SelectItem key={s.path} value={s.path}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

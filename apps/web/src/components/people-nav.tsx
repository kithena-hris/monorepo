'use client';

import {
  Button,
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
} from '@reach/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import type { Place } from '../lib/remotes';

/**
 * People's own navigation, beside its screens: the sections and actions the
 * People remote's manifest offers, already cut to what this viewer's roles
 * open (`placesFor`).
 *
 * The shell draws it rather than the remote. The remote says which places
 * exist; the host decides what its chrome looks like — so a host that sells
 * People on its own draws its own, and this one keeps its sidebar, then
 * People's sections, then the screen. Every link is a Next `Link`, so moving
 * between sections never reloads the page.
 *
 * Wide: a column of grouped links. Narrow: a select, because a dozen sections
 * do not fit across a phone. Which one shows is CSS; nothing here asks how wide
 * the window is.
 */
export interface PeopleNavProps {
  readonly sections: readonly Place[];
  readonly actions: readonly Place[];
  /** The manifest route this screen matched, as written there: `/people/:id`. */
  readonly route: string | null;
}

/**
 * The place this screen is under: the one at its route, or the one whose
 * `owns` lists it. The manifest decides, so a profile is the Directory's
 * because People says so, not because of what its URL looks like.
 */
export function currentPlace(places: readonly Place[], route: string | null): Place | undefined {
  return places.find((p) => p.path === route || p.owns?.includes(route ?? '') === true);
}

function groupsOf(sections: readonly Place[]): [string, Place[]][] {
  const groups = new Map<string, Place[]>();
  for (const s of sections) {
    const group = s.group ?? 'People';
    groups.set(group, [...(groups.get(group) ?? []), s]);
  }
  return [...groups];
}

export function PeopleNav({ sections, actions, route }: PeopleNavProps): JSX.Element | null {
  const router = useRouter();
  if (sections.length === 0 && actions.length === 0) return null;
  const current = currentPlace(sections, route);
  const groups = groupsOf(sections);

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-8 lg:w-56 lg:shrink-0">
      {/* The one Add employee on any People screen: screens never repeat an
          action, and on the action's own screen its form is the only copy. */}
      {actions
        .filter((a) => currentPlace([a], route) === undefined)
        .map((a) => (
          <Button key={a.path} variant="primary" fullWidth asChild>
            <Link href={a.path as Route}>{a.label}</Link>
          </Button>
        ))}

      <Nav label="People sections" className="hidden lg:block">
        <NavList>
          {groups.map(([group, places]) => (
            <NavGroup key={group} label={group}>
              {places.map((s) => (
                <NavItem key={s.path} asChild level={2} current={s === current}>
                  <Link href={s.path as Route}>{s.label}</Link>
                </NavItem>
              ))}
            </NavGroup>
          ))}
        </NavList>
      </Nav>

      <div className="lg:hidden">
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
            {groups.map(([group, places]) => (
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
    </div>
  );
}

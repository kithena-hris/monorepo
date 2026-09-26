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
import { usePathname, useRouter } from 'next/navigation';
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
}

/** The section this path is in: the longest that holds it; the overview only for itself. */
export function currentSection(sections: readonly Place[], pathname: string): Place | undefined {
  return sections
    .filter((s) =>
      s.path === '/people'
        ? pathname === s.path
        : pathname === s.path || pathname.startsWith(`${s.path}/`),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function groupsOf(sections: readonly Place[]): [string, Place[]][] {
  const groups = new Map<string, Place[]>();
  for (const s of sections) {
    const group = s.group ?? 'People';
    groups.set(group, [...(groups.get(group) ?? []), s]);
  }
  return [...groups];
}

export function PeopleNav({ sections, actions }: PeopleNavProps): JSX.Element | null {
  const pathname = usePathname();
  const router = useRouter();
  if (sections.length === 0 && actions.length === 0) return null;
  const current = currentSection(sections, pathname);
  const groups = groupsOf(sections);

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-8 lg:w-56 lg:shrink-0">
      {actions.map((a) => (
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

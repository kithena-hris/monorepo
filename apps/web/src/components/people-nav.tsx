'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
 * People's own navigation: the sections and actions the People remote's
 * manifest offers, already cut to what this viewer's roles open (`placesFor`).
 *
 * The shell draws it rather than the remote. The remote says which places
 * exist; the host decides what its chrome looks like — so a host that sells
 * People on its own draws its own. Every link is a Next `Link`, so moving
 * between sections never reloads the page.
 *
 * Two pieces, because the sections are not a column any more:
 *
 * - `PeopleSections`, the list itself, which the shell hangs off the People
 *   item in its sidebar as a flyout (`NavItem`'s `flyout`). It is there on
 *   hover, focus or a tap, and the screen keeps the full width otherwise.
 * - `PeopleBar`, above the screen: where you are (a breadcrumb, or on a phone,
 *   which has no sidebar, a select that is also the way to move), and the one
 *   action People offers here. Which of breadcrumb and select shows is CSS;
 *   nothing here asks how wide the window is.
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

/** The sections, grouped, the current one marked: the sidebar's People flyout. */
export function PeopleSections({
  sections,
  route,
}: Omit<PeopleNavProps, 'actions'>): JSX.Element | null {
  if (sections.length === 0) return null;
  const current = currentPlace(sections, route);
  return (
    <Nav label="People sections">
      <NavList>
        {groupsOf(sections).map(([group, places]) => (
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
  );
}

/** Where you are in People, and what you can start from here. */
export function PeopleBar({ sections, actions, route }: PeopleNavProps): JSX.Element | null {
  const router = useRouter();
  if (sections.length === 0 && actions.length === 0) return null;
  const current = currentPlace(sections, route);
  // Nested places only: on People's own front page a trail of one says nothing.
  const found = current ?? currentPlace(actions, route);
  const here = found?.path === '/people' ? undefined : found;
  // The one Add employee on any People screen: screens never repeat an
  // action, and on the action's own screen its form is the only copy.
  const offered = actions.filter((a) => currentPlace([a], route) === undefined);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {here === undefined ? (
        // Keeps the action at the trailing edge when there is no trail.
        <span className="max-md:hidden" />
      ) : (
        <Breadcrumb className="max-md:hidden">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/people">People</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{here.label}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}

      {sections.length === 0 ? null : (
        <div className="min-w-0 flex-1 md:hidden">
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
      )}

      {offered.length === 0 ? null : (
        <div className="flex shrink-0 items-center gap-2">
          {offered.map((a) => (
            <Button key={a.path} variant="primary" asChild>
              <Link href={a.path as Route}>{a.label}</Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

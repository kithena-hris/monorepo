'use client';

import {
  Badge,
  List,
  ListItem,
  MegaMenu,
  Nav,
  NavItem,
  NavList,
  SearchField,
  icons,
  type IconName,
} from '@reach/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';

import { currentPlace, type Place } from '../lib/remotes';
import { useHint } from './shortcuts';

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
 * - `PeopleSubnav`, the sections under the People item in an expanded
 *   sidebar: ruled rows, each with a count where something needs action.
 * - `PeopleSections`, the same sections as the collapsed rail's flyout: a
 *   compact menu of described rows, and where People's settings are.
 * - `PeopleMenu`, the same places as a phone's People tab: rows you push
 *   from, with the same counts.
 *
 * The breadcrumb, the tabs and the actions are not here: they join the
 * screen's own header (`headerFrame`), so a People page opens with one header.
 */
export interface PeopleNavProps {
  readonly sections: readonly Place[];
  /** The manifest route this screen matched, as written there: `/people/:id`. */
  readonly route: string | null;
  /** By section path, only what needs action (`countsOf`). */
  readonly counts?: Readonly<Record<string, number>>;
}

/** A manifest's icon name as a Reach icon; an unknown name draws nothing rather than failing. */
export function iconOf(name: string | undefined): JSX.Element | undefined {
  if (name === undefined || !(name in icons)) return undefined;
  const Icon = icons[name as IconName];
  return <Icon />;
}

/** A count as a small solid badge; approvals are the urgent tone, the rest a warning. */
function Count({ path, n }: { readonly path: string; readonly n: number }): JSX.Element {
  return (
    <Badge size="xs" variant="solid" tone={path.endsWith('/approvals') ? 'danger' : 'warning'}>
      {n}
      <span className="sr-only"> waiting</span>
    </Badge>
  );
}

function countOf(counts: Readonly<Record<string, number>>, path: string): { badge?: JSX.Element } {
  const n = counts[path];
  return n === undefined ? {} : { badge: <Count path={path} n={n} /> };
}

/** The sidebar's People pages, inline under its item (V2): ruled rows with their counts. */
export function PeopleSubnav({ sections, route, counts = {} }: PeopleNavProps): JSX.Element {
  const current = currentPlace(sections, route);
  const hint = useHint();
  return (
    <NavList variant="ruled" aria-label="People sections">
      {sections.map((s) => (
        <NavItem
          key={s.path}
          asChild
          level={2}
          current={s === current}
          shortcut={hint(s.path)}
          {...countOf(counts, s.path)}
        >
          <Link href={s.path}>{s.label}</Link>
        </NavItem>
      ))}
    </NavList>
  );
}

/**
 * The collapsed rail's People flyout (V8): the same places as a compact menu,
 * each with its icon, what it holds and its count, and where the settings are.
 */
export function PeopleSections({
  sections,
  route,
  counts = {},
}: PeopleNavProps): JSX.Element | null {
  const hint = useHint();
  if (sections.length === 0) return null;
  const current = currentPlace(sections, route);
  return (
    <MegaMenu
      size="compact"
      title="People"
      shortcut={hint('/people')}
      footer={
        <>
          <icons.settings aria-hidden />
          <span>
            Fields and roles are in{' '}
            <Link
              href="/settings"
              className="font-semibold text-fg underline-offset-4 hover:underline"
            >
              Settings › People
            </Link>
          </span>
        </>
      }
    >
      <Nav label="People sections">
        <NavList>
          {sections.map((s) => (
            <NavItem
              key={s.path}
              asChild
              level={2}
              current={s === current}
              icon={iconOf(s.icon)}
              description={s.description}
              shortcut={hint(s.path)}
              {...countOf(counts, s.path)}
            >
              <Link href={s.path}>{s.label}</Link>
            </NavItem>
          ))}
        </NavList>
      </Nav>
    </MegaMenu>
  );
}

/**
 * People as a phone's tab (MV1): six rows you push from, each a tile, its
 * name, a line on what it holds and its count, under a search of the
 * directory. Your own profile is the Me tab's, not a row here.
 */
export function PeopleMenu({
  sections,
  counts = {},
  total,
}: PeopleNavProps & { readonly total?: number | null }): JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <SearchField
        label="Search people"
        placeholder={
          total == null ? 'Search people' : `Search ${total.toLocaleString('en-GB')} people`
        }
        value={query}
        onValueChange={setQuery}
        onSearch={(value) => {
          router.push(`/people/directory/list?q=${encodeURIComponent(value)}` as Route);
        }}
      />
      <List aria-label="People sections">
        {sections.map((s) => {
          const n = counts[s.path];
          // What waits for you says so; otherwise the line says what it holds.
          const waiting =
            n !== undefined && s.path.endsWith('/approvals')
              ? `${String(n)} waiting for you`
              : undefined;
          return (
            <ListItem
              key={s.path}
              asChild
              chevron
              icon={iconOf(s.icon)}
              description={waiting ?? s.summary ?? s.description}
              {...(n === undefined ? {} : { trailing: <Count path={s.path} n={n} /> })}
            >
              <Link href={s.path}>{s.label}</Link>
            </ListItem>
          );
        })}
      </List>
      <p className="px-4 text-sm text-fg-muted">Your own profile is in the Me tab.</p>
    </div>
  );
}

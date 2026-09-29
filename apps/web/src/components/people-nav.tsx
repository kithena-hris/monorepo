'use client';

import {
  Avatar,
  Badge,
  Chip,
  Kbd,
  List,
  ListItem,
  MegaMenu,
  Nav,
  NavGroup,
  NavItem,
  NavList,
  SearchField,
  icons,
  type IconName,
} from '@reach/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

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
 * - `PeopleSections`, the mega menu the shell hangs off the People item in its
 *   sidebar (`NavItem`'s `flyout`): a field to jump to a page, the places you
 *   were last, the sections in columns with a count where something needs
 *   action, and the way to People's settings.
 * - `PeopleMenu`, the same places as a phone's People tab: grouped rows you
 *   push from, with the same counts.
 *
 * The breadcrumb and the actions are not here: they join the screen's own
 * header (`headerFrame`), so a People page opens with one header.
 */
export interface PeopleNavProps {
  readonly sections: readonly Place[];
  /** The manifest route this screen matched, as written there: `/people/:id`. */
  readonly route: string | null;
  /** By section path, only what needs action (`countsOf`). */
  readonly counts?: Readonly<Record<string, number>>;
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

const RECENT_KEY = 'kithena.people.recent';

/**
 * The last places this person opened in People, newest first, kept in this
 * browser only: a convenience, not a record, so it is fine for it to be
 * empty in a private window.
 */
export function useRecentPlaces(sections: readonly Place[], route: string | null): Place[] {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    let stored: string[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
    } catch {
      /* nothing remembered */
    }
    const here = currentPlace(sections, route);
    const next =
      here === undefined
        ? stored
        : [here.path, ...stored.filter((p) => p !== here.path)].slice(0, 3);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* not remembered, still shown */
    }
  }, [sections, route]);
  return recent.flatMap((path) => sections.filter((s) => s.path === path)).slice(0, 2);
}

/** The sidebar's People menu: the design's mega menu, in the shell's flyout. */
export function PeopleSections({
  sections,
  route,
  counts = {},
}: PeopleNavProps): JSX.Element | null {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const recent = useRecentPlaces(sections, route);
  if (sections.length === 0) return null;
  const current = currentPlace(sections, route);
  const needle = query.trim().toLowerCase();
  const shown = groupsOf(
    sections.filter(
      (s) =>
        needle === '' ||
        s.label.toLowerCase().includes(needle) ||
        (s.description ?? '').toLowerCase().includes(needle),
    ),
  );
  return (
    <MegaMenu
      search={
        <SearchField
          size="sm"
          label="Jump to a People page"
          placeholder="Jump to a page"
          value={query}
          onValueChange={setQuery}
        />
      }
      recent={
        recent.length === 0 ? undefined : (
          <>
            {recent.map((p) => (
              <Chip
                key={p.path}
                startIcon={iconOf(p.icon)}
                onClick={() => {
                  router.push(p.path);
                }}
              >
                {p.label}
              </Chip>
            ))}
          </>
        )
      }
      footer={
        <>
          <icons.settings aria-hidden />
          <span className="flex-1">
            Fields, roles and integrations live in{' '}
            <Link
              href="/settings"
              className="font-semibold text-fg underline-offset-4 hover:underline"
            >
              Settings › People
            </Link>
          </span>
          <Kbd>G</Kbd>
          <Kbd>P</Kbd>
          <span>opens People</span>
        </>
      }
    >
      <Nav label="People sections">
        {shown.length === 0 ? (
          <p className="px-2.5 text-sm text-fg-muted">No page is called that.</p>
        ) : (
          <NavList columns={2}>
            {shown.map(([group, places]) => (
              <NavGroup key={group} label={group}>
                {places.map((s) => {
                  const n = counts[s.path];
                  return (
                    <NavItem
                      key={s.path}
                      asChild
                      level={2}
                      current={s === current}
                      icon={iconOf(s.icon)}
                      description={s.description}
                      {...(n === undefined ? {} : { badge: <Count path={s.path} n={n} /> })}
                    >
                      <Link href={s.path}>{s.label}</Link>
                    </NavItem>
                  );
                })}
              </NavGroup>
            ))}
          </NavList>
        )}
      </Nav>
    </MegaMenu>
  );
}

const TILE_TONES = ['accent', 'info', 'success', 'warning', 'danger'] as const;

/**
 * People as a phone's tab: the same groups and counts as the sidebar menu, as
 * rows you push from, under a search of the directory.
 */
export function PeopleMenu({
  sections,
  counts = {},
  total,
}: PeopleNavProps & { readonly total?: number | null }): JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState('');
  return (
    <div className="flex flex-col gap-4.5">
      <SearchField
        label="Search people"
        placeholder={total == null ? 'Search people' : `Search ${String(total)} people`}
        value={query}
        onValueChange={setQuery}
        onSearch={(value) => {
          router.push(`/people/directory?search=${encodeURIComponent(value)}` as Route);
        }}
      />
      {groupsOf(sections).map(([group, places], g) => (
        <section key={group} aria-label={group} className="flex flex-col gap-1.5">
          <h2 className="px-4 text-sm font-medium text-fg-muted">{group}</h2>
          <List>
            {places.map((s, i) => {
              const n = counts[s.path];
              return (
                <ListItem
                  key={s.path}
                  asChild
                  chevron
                  leading={
                    <Avatar
                      name={s.label}
                      size="md"
                      shape="rounded"
                      tone={TILE_TONES[(i + g) % TILE_TONES.length]}
                      fallback={iconOf(s.icon)}
                    />
                  }
                  {...(n === undefined
                    ? {}
                    : { trailing: <span className="text-base tabular-nums">{n}</span> })}
                >
                  <Link href={s.path}>{s.label}</Link>
                </ListItem>
              );
            })}
          </List>
        </section>
      ))}
    </div>
  );
}

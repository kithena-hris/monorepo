'use client';

import { Skeleton } from '@reach/ui';
import { usePathname, useSearchParams } from 'next/navigation';
import type { JSX } from 'react';

import { inboxView } from '../lib/inbox';
import { headerFrame, matchPath } from '../lib/remotes';
import { PEOPLE_NOW_PATHS, settingsModules } from '../lib/settings-modules';
import { AccountSheet, useShellData, useShellPerson } from './app-shell';
import { HomeLoading } from './home-dashboard';
import { Inbox } from './inbox';
import { PeopleLoading } from './people-screen';
import { SettingsIndex } from './settings-index';
import { TimeOffLoading } from './timeoff-screen';

/** Every People setting's "how it is set now", still to come. */
const PENDING_NOW = Object.fromEntries(PEOPLE_NOW_PATHS.map((path) => [path, '']));

/**
 * A page inside the shell while it is fetched: every `loading.tsx` under
 * `(app)`, so a prefetched link shows this on the frame after the click.
 *
 * In the shape of the page it is going to, read from the address rather than
 * from where the boundary sits, because the boundary that shows is whichever
 * one the navigation crossed first — the area's, or the section's — and each
 * must draw the destination, not itself.
 *
 * - A People screen: what is already known of it — another tab or view of
 *   the page on screen, or the page as last seen — drawn in place, so what
 *   it shares with the page on screen stays put (`PeopleLoading`). Failing
 *   that, the skeleton the screen shows while its own code loads
 *   (`people-screen.tsx`), with the header `headerFrame` gives it — a
 *   breadcrumb, and on an umbrella page as many tabs as this viewer opens.
 * - A Time Off screen: the screen itself, loading, under its real header,
 *   so it draws its own skeleton in its exact shape (`TimeOffLoading`).
 * - The inbox: the inbox itself, from the shell's copy of what the bell holds.
 * - Settings: the page itself from the shell's places, each card's "set now"
 *   still to come.
 * - Home: the dashboard's header, tiles and cards with their figures to come.
 * - Any other: the page skeleton, under its trail in Settings.
 */
export function PageLoading(): JSX.Element {
  const shell = useShellData();
  const person = useShellPerson();
  const pathname = usePathname();
  const search = useSearchParams();
  if (pathname === '/people' || (pathname.startsWith('/people/') && pathname !== '/people/menu')) {
    const frame = headerFrame(
      { sections: shell.sections, actions: shell.actions ?? [] },
      matchPath(shell.routes, pathname)?.path ?? null,
      '/people',
    );
    return (
      <PeopleLoading
        skeleton={
          <Skeleton
            shape="page"
            label="Loading People"
            breadcrumb={frame.section !== null}
            tabs={frame.tabs?.length ?? 0}
          />
        }
      />
    );
  }
  if (pathname.startsWith('/time-off/') || pathname.startsWith('/settings/time-off/')) {
    return <TimeOffLoading />;
  }
  // People's settings: the same, under their trail in Settings.
  if (pathname.startsWith('/settings/people/')) {
    return <PeopleLoading skeleton={<Skeleton shape="page" label="Loading" breadcrumb />} />;
  }
  if (pathname === '/inbox' && person !== null) {
    // The view in the address; the flagged rows are People's, still on their way.
    return (
      <Inbox
        shell={shell}
        person={person}
        view={inboxView(search.get('view') ?? undefined)}
        flagged={undefined}
      />
    );
  }
  if (pathname === '/settings') {
    return (
      <SettingsIndex modules={settingsModules(shell, { now: PENDING_NOW, attention: {} }, '')} />
    );
  }
  if (pathname === '/') {
    return (
      <HomeLoading
        account={person === null ? null : <AccountSheet person={person} />}
        people={shell.sections.length > 0}
        hr={shell.roles.hr}
      />
    );
  }
  // A setting's page opens under its trail: Settings › People › Roles.
  return <Skeleton shape="page" label="Loading" breadcrumb={pathname.startsWith('/settings/')} />;
}

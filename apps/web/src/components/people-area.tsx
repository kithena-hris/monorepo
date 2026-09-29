import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { PeopleScreen } from './people-screen';
import { WorkspaceAsleep } from './workspace-asleep';
import { loadScreen, today } from '../lib/people-screens';
import { prepareRemoteSsr } from '../lib/remote-code';
import {
  currentPlace,
  firstUnder,
  headerFrame,
  peopleRoute,
  placesFor,
  siblingsOf,
} from '../lib/remotes';
import { shellData } from '../lib/shell';
import { currentPerson } from '../lib/session';
import { withQuery } from '../lib/url-state';
import { workspaceConfig } from '../lib/workspace';

/**
 * A People screen inside the shell: under `/people`, or among People's
 * settings under `/settings/people`.
 *
 * The shell does what only the shell may: reads the session, asks the remote's
 * manifest which screen owns the path, fetches that screen's data from People
 * as the person signed in (PEO-098), and hands the screen its header: the
 * breadcrumb, tabs and actions from the same manifest, cut to this person's
 * roles. The sidebar around it is the `(app)` layout's, drawn once.
 * The screen itself comes from wherever the remote is deployed — its server
 * build for the HTML, its browser build to hydrate (PEO-094) — so shipping a
 * change to it never rebuilds this app.
 *
 * `area` is where the screen sits in the host's navigation: among People's
 * sections, or on the Settings page, whose trail is Settings › People.
 */
export async function PeopleArea({
  path,
  search,
  area,
}: {
  readonly path: string;
  readonly search: Readonly<Record<string, string>>;
  readonly area: 'people' | 'settings';
}): Promise<JSX.Element> {
  const person = await currentPerson();
  if (person === null) redirect('/login');
  // A company that did not buy People has no People screens (PEO-114).
  if (!person.entitlements.includes('module.people')) notFound();

  const route = await peopleRoute(path);
  // A section's bare path also fits `/people/:id`; it is the section, not a
  // person called `data-health`, whatever this viewer may open under it.
  const bare =
    route != null &&
    Object.keys(route.params).length > 0 &&
    firstUnder(route.nav.sections, path) !== undefined;
  if (route === undefined || bare) {
    // A section's bare path (`/people/data-health`) is the first of its tabs
    // this person opens, query and all; anything else nobody answers is a 404.
    const to =
      area === 'people'
        ? firstUnder((await shellData(person.entitlements)).sections, path)
        : undefined;
    if (to === undefined) notFound();
    const query = new URLSearchParams(search).toString();
    redirect(query === '' ? to : `${to}?${query}`);
  }

  // Server rendering: a build whose signed manifest verifies, rendered in a
  // process of its own (`lib/remote-code.ts`, PEO-115). `PEOPLE_REMOTE_SSR=off`
  // is still the switch.
  const [load, ssr, shell] = await Promise.all([
    route === null
      ? ({ status: 'none' } as const)
      : loadScreen(route.component, { params: route.params, search }),
    route === null || process.env['PEOPLE_REMOTE_SSR'] === 'off'
      ? undefined
      : prepareRemoteSsr(route.base),
    // Which of People's places this person's roles open, the counts and the
    // notices, for the shell around the screen.
    shellData(person.entitlements),
  ]);
  const roles = shell.roles;

  // Nothing published yet: the administrator who can publish it is taken to
  // the wizard that does (design screen 2), rather than left on a screen
  // with nothing to show. Anybody else is told, on the screen they asked for.
  if (
    load.status === 'error' &&
    load.code === 'SCHEMA_NOT_PUBLISHED' &&
    roles.admin &&
    route?.component !== 'PeopleSetup' &&
    route?.component !== 'PeopleSettings'
  ) {
    redirect('/people/setup');
  }
  const places =
    route === null ? { sections: [], actions: [], settings: [] } : placesFor(route.nav, roles);
  const here = route?.path ?? null;

  const header = headerFrame(places, here, '/people', {
    sections: shell.counts,
    tabs: shell.tabCounts,
  });
  // Every Insights tab reads the same segment, so moving between them keeps it.
  const segment = search['segment'];
  const frame =
    area === 'people'
      ? here?.startsWith('/people/insights/') === true &&
        segment !== undefined &&
        segment !== '' &&
        header.tabs !== undefined
        ? {
            ...header,
            tabs: header.tabs.map((t) => ({
              ...t,
              href: withQuery(t.href, {}, { segment }),
            })),
          }
        : header
      : {
          // The settings overview is "Settings › People"; a setting is
          // "Settings › People › Roles". No actions: nobody adds an employee
          // from a settings page.
          section:
            here === '/settings/people'
              ? 'People'
              : (currentPlace(places.settings, here)?.label ?? null),
          trail:
            here === '/settings/people'
              ? [{ href: '/settings', label: 'Settings' }]
              : [
                  { href: '/settings', label: 'Settings' },
                  { href: '/settings', label: 'People' },
                ],
          actions: [],
          // The breadcrumb's last crumb lists the other settings.
          siblings:
            here === '/settings/people'
              ? []
              : siblingsOf(
                  places.settings.map((p) => ({ ...p, group: 'People settings' })),
                  currentPlace(places.settings, here),
                ),
          siblingsLabel: 'People settings',
        };

  // Nothing answered at the router and the VM can be woken: wake it.
  return load.status === 'error' && load.unreachable === true && workspaceConfig() !== null ? (
    <WorkspaceAsleep />
  ) : (
    // The screen, whose own header carries the breadcrumb (on a phone, the
    // title that switches section) and what this person may start from here.
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <PeopleScreen
          route={
            route === null
              ? null
              : {
                  entry: route.entry,
                  component: route.component,
                  ...(ssr === undefined ? {} : { ssr: ssr.ssr, stylesheet: ssr.stylesheet }),
                }
          }
          load={load}
          params={route?.params ?? {}}
          search={search}
          today={today()}
          frame={frame}
        />
      </div>
    </div>
  );
}

/** The query string as a flat record: repeated keys and arrays are dropped. */
export async function flatSearch(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(await searchParams).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
}

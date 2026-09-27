import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from './app-shell';
import { PeopleBar, PeopleSections } from './people-nav';
import { PeopleScreen } from './people-screen';
import { WorkspaceAsleep } from './workspace-asleep';
import { currentTenant } from '../lib/branding';
import { people } from '../lib/people';
import { loadScreen, today } from '../lib/people-screens';
import { prepareRemoteSsr } from '../lib/remote-code';
import { currentPlace, headerFrame, peopleRoute, placesFor } from '../lib/remotes';
import { currentPerson, displayName } from '../lib/session';
import { workspaceConfig } from '../lib/workspace';

/**
 * A People screen inside the shell: under `/people`, or among People's
 * settings under `/settings/people`.
 *
 * The shell does what only the shell may: reads the session, asks the remote's
 * manifest which screen owns the path, fetches that screen's data from People
 * as the person signed in (PEO-098), and draws the chrome — its own sidebar,
 * and People's sections from the same manifest, cut to this person's roles.
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
  if (route === undefined) notFound();

  // Server rendering: a build whose signed manifest verifies, rendered in a
  // process of its own (`lib/remote-code.ts`, PEO-115). `PEOPLE_REMOTE_SSR=off`
  // is still the switch.
  const [load, ssr, home] = await Promise.all([
    route === null
      ? ({ status: 'none' } as const)
      : loadScreen(route.component, { params: route.params, search }),
    route === null || process.env['PEOPLE_REMOTE_SSR'] === 'off'
      ? undefined
      : prepareRemoteSsr(route.base),
    // Which of People's places this person's roles open, for its navigation.
    // People answers it whether or not anything is published yet.
    people<{ hr: boolean; admin: boolean; finance: boolean }>('Home'),
  ]);
  const roles = home.ok ? home.data : { hr: false, admin: false, finance: false };

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

  const frame =
    area === 'people'
      ? headerFrame(places, here, '/people')
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
                  { href: '/settings/people', label: 'People' },
                ],
          actions: [],
        };

  const tenant = await currentTenant();
  const name =
    person.name === null
      ? displayName(person.workEmail)
      : `${person.name.given} ${person.name.family}`;
  return (
    <AppShell
      person={{ name, email: person.workEmail }}
      companyName={tenant?.branding.displayName ?? tenant?.slug ?? 'your company'}
      logoUrl={tenant?.branding.logoUrl ?? null}
      entitlements={person.entitlements}
      // People's sections hang off its sidebar item, on demand; the screen
      // keeps the full width.
      sections={
        places.sections.length === 0
          ? {}
          : {
              '/people': (
                <PeopleSections
                  sections={places.sections}
                  route={area === 'people' ? here : null}
                />
              ),
            }
      }
    >
      {/* Nothing answered at the router and the VM can be woken: wake it. */}
      {load.status === 'error' && load.unreachable === true && workspaceConfig() !== null ? (
        <WorkspaceAsleep />
      ) : (
        // A phone's section select, then the screen, whose own header carries
        // the breadcrumb and what this person may start from here.
        <div className="flex flex-col gap-6">
          {area === 'people' ? <PeopleBar sections={places.sections} route={here} /> : null}
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
      )}
    </AppShell>
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

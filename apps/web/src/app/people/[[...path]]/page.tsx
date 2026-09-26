import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../../../components/app-shell';
import { PeopleNav } from '../../../components/people-nav';
import { PeopleScreen } from '../../../components/people-screen';
import { WorkspaceAsleep } from '../../../components/workspace-asleep';
import { currentTenant } from '../../../lib/branding';
import { people } from '../../../lib/people';
import { loadScreen, today } from '../../../lib/people-screens';
import { prepareRemoteSsr } from '../../../lib/remote-code';
import { peopleRoute, placesFor } from '../../../lib/remotes';
import { currentPerson, displayName } from '../../../lib/session';
import { workspaceConfig } from '../../../lib/workspace';

/**
 * Everything under `/people`, rendered by the People remote.
 *
 * The shell does what only the shell may: reads the session, asks the remote's
 * manifest which screen owns the path, fetches that screen's data from People
 * as the person signed in (PEO-098), and draws the chrome — its own sidebar,
 * and People's sections from the same manifest, cut to this person's roles. The screen itself
 * comes from wherever the remote is deployed — its server build for the HTML,
 * its browser build to hydrate (PEO-094) — so shipping a change to it never
 * rebuilds this app.
 */
export default async function People({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const person = await currentPerson();
  if (person === null) redirect('/login');
  // A company that did not buy People has no People screens (PEO-114).
  if (!person.entitlements.includes('module.people')) notFound();

  const { path = [] } = await params;
  const route = await peopleRoute(['/people', ...path].join('/'));
  if (route === undefined) notFound();

  const search = Object.fromEntries(
    Object.entries(await searchParams).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
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
    route?.component !== 'PeopleSetup'
  ) {
    redirect('/people/setup');
  }
  const places = route === null ? { sections: [], actions: [] } : placesFor(route.nav, roles);

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
    >
      {/* Nothing answered at the router and the VM can be woken: wake it. */}
      {load.status === 'error' && load.unreachable === true && workspaceConfig() !== null ? (
        <WorkspaceAsleep />
      ) : (
        // The shell's sidebar, then People's own sections, then the screen.
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <PeopleNav sections={places.sections} actions={places.actions} />
          <div className="min-w-0 flex-1">
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
              roles={roles}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}

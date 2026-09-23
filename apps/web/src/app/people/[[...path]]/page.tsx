import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../../../components/app-shell';
import { PeopleScreen } from '../../../components/people-screen';
import { currentTenant } from '../../../lib/branding';
import { loadScreen, today } from '../../../lib/people-screens';
import { peopleRoute } from '../../../lib/remotes';
import { currentPerson, displayName } from '../../../lib/session';

/**
 * Everything under `/people`, rendered by the People remote.
 *
 * The shell does what only the shell may: reads the session, asks the remote's
 * manifest which screen owns the path, fetches that screen's data from People
 * as the person signed in (PEO-098), and draws the chrome. The screen itself
 * arrives from wherever the remote is deployed, so shipping a change to it
 * never rebuilds this app.
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
  const load =
    route === null
      ? ({ status: 'none' } as const)
      : await loadScreen(route.component, { params: route.params, search });

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
      <PeopleScreen
        route={route === null ? null : { entry: route.entry, component: route.component }}
        load={load}
        params={route?.params ?? {}}
        search={search}
        today={today()}
      />
    </AppShell>
  );
}

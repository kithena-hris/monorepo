import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../../../components/app-shell';
import { RemoteScreen } from '../../../components/remote-screen';
import { currentTenant } from '../../../lib/branding';
import { peopleRoute } from '../../../lib/remotes';
import { currentPerson, displayName } from '../../../lib/session';

/**
 * Everything under `/people`, rendered by the People remote.
 *
 * The shell does what only the shell may: reads the session, asks the remote's
 * manifest which screen owns the path, and draws the chrome. The screen itself
 * arrives in the browser from wherever the remote is deployed, so shipping a
 * change to it never rebuilds this app.
 */
export default async function People({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}): Promise<JSX.Element> {
  const person = await currentPerson();
  if (person === null) redirect('/login');

  const { path = [] } = await params;
  const route = await peopleRoute(['/people', ...path].join('/'));
  if (route === undefined) notFound();

  const tenant = await currentTenant();
  const name =
    person.name === null ? displayName(person.workEmail) : `${person.name.given} ${person.name.family}`;
  return (
    <AppShell
      person={{ name, email: person.workEmail }}
      companyName={tenant?.branding.displayName ?? tenant?.slug ?? 'your company'}
      logoUrl={tenant?.branding.logoUrl ?? null}
    >
      <RemoteScreen name="people" area="People" route={route} />
    </AppShell>
  );
}

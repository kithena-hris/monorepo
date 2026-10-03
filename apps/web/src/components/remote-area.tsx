import { PageHeader } from '@reach/ui';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { RemoteScreen } from './remote-screen';
import { prepareRemoteSsr } from '../lib/remote-code';
import { areaOf, remoteRoute } from '../lib/remotes';
import { currentPerson } from '../lib/session';

/**
 * A screen of any remote in `AREAS`, under its own paths or among its
 * settings, for an area whose screens the shell does not yet fetch data for.
 *
 * The same order as `PeopleArea`: the session, then the entitlement that
 * opens the area (a company that did not buy it has no such screens), then
 * the remote's manifest for which screen the path is, its server build if it
 * verifies, and the screen. People keeps its own (`people-area.tsx`) for what
 * only People has: its reads, its setup wizard and its header frame.
 *
 * A remote that is not configured, or not answering, is the area saying it is
 * unavailable under its own title, never a crashed page.
 */
export async function RemoteArea({
  path,
  search,
}: {
  readonly path: string;
  readonly search: Readonly<Record<string, string>>;
}): Promise<JSX.Element> {
  const area = areaOf(path);
  const [person, route] = await Promise.all([currentPerson(), remoteRoute(path)]);
  if (person === null) redirect('/login');
  if (area === undefined || !person.entitlements.includes(area.entitlement)) notFound();
  if (route === undefined) notFound();
  if (route === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={area.label} />
        <RemoteScreen name={area.name} area={area.label} route={null} />
      </div>
    );
  }
  const ssr = await prepareRemoteSsr(route.base, route.area);
  return (
    <RemoteScreen
      name={area.name}
      area={area.label}
      route={{
        entry: route.entry,
        component: route.component,
        ...(ssr === undefined ? {} : { ssr: ssr.ssr, stylesheet: ssr.stylesheet }),
      }}
      props={{ path, params: route.params, search }}
    />
  );
}

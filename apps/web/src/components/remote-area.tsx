import { PageHeader } from '@reach/ui';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { RemoteScreen } from './remote-screen';
import { TimeOffScreen } from './timeoff-screen';
import type { ScreenLoad, ScreenQuery } from '../lib/people-screens';
import { prepareRemoteSsr } from '../lib/remote-code';
import { areaOf, firstUnder, remoteRoute, type Area } from '../lib/remotes';
import { currentPerson } from '../lib/session';
import { shellData } from '../lib/shell';
import { areaFrame } from '../lib/shell-data';
import { loadScreen as loadTimeOffScreen } from '../lib/timeoff-screens';

/**
 * Each area's screen data, by its name in `AREAS`: the read the screen is
 * drawn from, fetched here as the person signed in, and the client component
 * that hands it to the remote with the area's actions. People keeps its own
 * (`people-area.tsx`).
 */
const SCREENS: Partial<
  Record<
    Area['name'],
    {
      readonly load: (component: string, query: ScreenQuery) => Promise<ScreenLoad>;
      readonly Screen: typeof TimeOffScreen;
    }
  >
> = {
  timeoff: { load: loadTimeOffScreen, Screen: TimeOffScreen },
};

/**
 * A screen of any remote in `AREAS` but People's, under its own paths or
 * among its settings.
 *
 * The same order as `PeopleArea`: the session, then the entitlement that
 * opens the area (a company that did not buy it has no such screens), then
 * the remote's manifest for which screen the path is, its server build if it
 * verifies, the screen's data (`SCREENS`), and the screen with its header:
 * the trail, the section's tabs and the actions, from the same manifest cut
 * to this person's roles, with their counts. People keeps
 * its own (`people-area.tsx`) for what only People has: its reads and its
 * setup wizard.
 *
 * A bare path (`/time-off`, `/time-off/requests`) is the first place under it
 * this person opens, query and all. A remote that is not configured, or not
 * answering, is the area saying it is unavailable under its own title, never a
 * crashed page.
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
  const places = (await shellData(person.entitlements)).remotes?.[area.name];
  if (route === undefined) {
    const to = firstUnder(places?.sections ?? [], path);
    if (to === undefined) notFound();
    const query = new URLSearchParams(search).toString();
    redirect(query === '' ? to : `${to}?${query}`);
  }
  if (route === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={area.label} />
        <RemoteScreen name={area.name} area={area.label} route={null} />
      </div>
    );
  }
  const screens = SCREENS[area.name];
  const [ssr, load] = await Promise.all([
    prepareRemoteSsr(route.base, route.area),
    screens?.load(route.component, { params: route.params, search }) ??
      ({ status: 'none' } as const),
  ]);
  const drawn = {
    entry: route.entry,
    component: route.component,
    ...(ssr === undefined ? {} : { ssr: ssr.ssr, stylesheet: ssr.stylesheet }),
  };
  const frame = areaFrame(area, route.path, places);
  if (screens !== undefined) return <screens.Screen route={drawn} load={load} frame={frame} />;
  return (
    <RemoteScreen
      name={area.name}
      area={area.label}
      route={drawn}
      props={{ path, params: route.params, search, frame }}
    />
  );
}

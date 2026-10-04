import { PageHeader } from '@reach/ui';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { RemoteScreen } from './remote-screen';
import { TimeOffScreen } from './timeoff-screen';
import type { ScreenLoad, ScreenQuery } from '../lib/people-screens';
import { prepareRemoteSsr } from '../lib/remote-code';
import { remoteRoute } from '../lib/remote-manifest';
import { areaOf, firstUnder, type Area } from '../lib/remotes';
import { currentPerson } from '../lib/session';
import { remotePlaces, warmArea } from '../lib/shell';
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
      readonly load: (component: string, query: ScreenQuery, path: string) => Promise<ScreenLoad>;
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
  // The header's reads, beside the session check rather than after it.
  if (area !== undefined) warmArea(area);
  const routed = remoteRoute(path);
  // The screen's data and server build, started as soon as the manifest says
  // which screen it is: beside the session check and the shell's reads, not
  // after them. `people.ts` withholds every answer until identity confirms
  // the session; a page that is not drawn drops them unread.
  const screens = area === undefined ? undefined : SCREENS[area.name];
  const loading = routed.then((r) =>
    r == null || screens === undefined
      ? ({ status: 'none' } as const)
      : screens.load(r.component, { params: r.params, search }, r.path),
  );
  const preparing = routed.then((r) => (r == null ? undefined : prepareRemoteSsr(r.base, r.area)));
  const [person, route] = await Promise.all([currentPerson(), routed]);
  if (person === null) redirect('/login');
  if (area === undefined || !person.entitlements.includes(area.entitlement)) notFound();
  const places = (await remotePlaces(person.entitlements))[area.name];
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
  const [ssr, load] = await Promise.all([preparing, loading]);
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

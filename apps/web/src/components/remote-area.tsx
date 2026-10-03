import { PageHeader } from '@reach/ui';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { RemoteScreen } from './remote-screen';
import { prepareRemoteSsr } from '../lib/remote-code';
import {
  areaOf,
  currentPlace,
  firstUnder,
  headerFrame,
  remoteRoute,
  siblingsOf,
  type Area,
  type RemoteRoute,
} from '../lib/remotes';
import { currentPerson } from '../lib/session';
import { shellData } from '../lib/shell';
import type { AreaPlaces } from '../lib/shell-data';

/**
 * A screen of any remote in `AREAS`, under its own paths or among its
 * settings, for an area whose screens the shell does not yet fetch data for.
 *
 * The same order as `PeopleArea`: the session, then the entitlement that
 * opens the area (a company that did not buy it has no such screens), then
 * the remote's manifest for which screen the path is, its server build if it
 * verifies, and the screen with its header: the trail, the section's tabs and
 * the actions, from the same manifest cut to this person's roles. People keeps
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
      props={{ path, params: route.params, search, frame: frameOf(area, route, places) }}
    />
  );
}

/**
 * The screen's header from the area's places: "Time off › Requests ›
 * Decided" among its sections, "Settings › Time off › Leave types" among its
 * settings, each crumb a switcher to its siblings. No actions on a setting.
 */
function frameOf(area: Area, route: RemoteRoute, places: AreaPlaces | undefined) {
  const own = places ?? { sections: [], actions: [], settings: [] };
  if (!route.path.startsWith(`${area.settings}/`)) {
    return {
      ...headerFrame(own, route.path, area.home, {}, area.label),
      trail: [{ href: area.home, label: area.label }],
    };
  }
  const settings = own.settings.map((p) => ({ ...p, group: `${area.label} settings` }));
  const here = currentPlace(settings, route.path);
  return {
    section: here?.label ?? null,
    trail: [
      { href: '/settings', label: 'Settings' },
      { href: '/settings', label: area.label },
    ],
    actions: [],
    siblings: siblingsOf(settings, here),
    siblingsLabel: `${area.label} settings`,
  };
}

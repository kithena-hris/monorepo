import 'server-only';

import { cache } from 'react';
import { people, timeOff } from './people';
import { AREAS, placesFor, remoteNav, type Area } from './remotes';
import {
  countsOf,
  EMPTY_SHELL,
  noticesOf,
  timeOffCounts,
  timeOffRoles,
  type AreaPlaces,
  type Overview,
  type ShellData,
  type TimeOffViewer,
  type Waiting,
} from './shell-data';

export type { ShellData } from './shell-data';

/**
 * How many ID checks, duplicates and access requests wait, for HR and
 * finance: People's own count, as the person signed in, null for a queue they
 * do not have. Asked beside the roles, not after them: People answers nulls
 * for anybody else at once.
 */
async function waitingFor(): Promise<Waiting | null> {
  const answer = await people<Waiting>('Waiting');
  return answer.ok ? answer.data : null;
}

/**
 * Once per request, by entitlement set: the shell's layout and the page under
 * it both ask, and each read is several of People's.
 */
export function shellData(entitlements: readonly string[]): Promise<ShellData> {
  return shellDataOnce(entitlements.join('\n'));
}

const shellDataOnce = cache(async (key: string): Promise<ShellData> => {
  const entitlements = key === '' ? [] : key.split('\n');
  // Every other area's manifest, asked beside People rather than after it;
  // cut to the roles People answers with, none where there is no People.
  const others = Object.values(AREAS).filter(
    (a) => a !== AREAS.people && entitlements.includes(a.entitlement),
  );
  const base = peopleShell(entitlements);
  const [shell, areas] = await Promise.all([
    base,
    Promise.all(others.map(async (a) => [a.name, await areaPlaces(a, base)] as const)),
  ]);
  const remotes = Object.fromEntries(areas.flatMap(([name, p]) => (p === null ? [] : [[name, p]])));
  return { ...shell, remotes };
});

/**
 * An area's places for this viewer, from its manifest. Time Off is asked once
 * per page who the viewer is to it (`timeOffViewer`, TOF-058a), beside the
 * manifest: whether they approve anybody opens its queues, and what waits
 * for them is its counts. A Time Off that does not answer leaves the shell's
 * roles and no counts, never a guess.
 */
async function areaPlaces(area: Area, base: Promise<ShellData>): Promise<AreaPlaces | null> {
  const [found, shell, viewer] = await Promise.all([
    remoteNav(area),
    base,
    area === AREAS.timeoff
      ? timeOff<TimeOffViewer>('TimeOffViewer').then((a) => (a.ok ? a.data : null))
      : null,
  ]);
  if (found === null) return null;
  const places = placesFor(found.nav, timeOffRoles(shell.roles, viewer));
  const counts = timeOffCounts(viewer, places.sections);
  return {
    ...places,
    routes: found.routes,
    screens: found.screens,
    counts: counts.sections,
    tabCounts: counts.tabs,
    slots: found.slots,
  };
}

/** People's part of the shell: its places, counts and notices, for a company that has it. */
async function peopleShell(entitlements: readonly string[]): Promise<ShellData> {
  if (!entitlements.includes('module.people')) return EMPTY_SHELL;
  // All at once: the roles on their own (People answers them whether or not
  // anything is published yet, which the overview does not), the overview,
  // and what waits for a decision, which needs nobody's roles to be asked.
  const [route, overview, answered, waiting] = await Promise.all([
    // The manifest, whichever path is asked for: People's own front page is Home's now.
    remoteNav(AREAS.people).catch(() => null),
    people<Overview>('Overview'),
    people<ShellData['roles']>('Home'),
    waitingFor(),
  ]);
  const data = overview.ok ? overview.data : null;
  const roles = answered.ok ? answered.data : (data?.roles ?? EMPTY_SHELL.roles);
  if (route === null) return { ...EMPTY_SHELL, roles };
  const places = placesFor(route.nav, roles);
  const counts = data === null ? null : countsOf(data, waiting, places.sections);
  return {
    roles,
    sections: places.sections,
    settings: places.settings,
    actions: places.actions,
    routes: route.routes,
    screens: route.screens,
    counts: counts?.sections ?? {},
    tabCounts: counts?.tabs ?? {},
    notices: data === null ? [] : noticesOf(data),
    viewedAs: data?.viewedAs ?? [],
    now: data?.now ?? null,
  };
}

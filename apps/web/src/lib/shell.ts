import 'server-only';

import { cache } from 'react';
import { people } from './people';
import { peopleRoute, placesFor } from './remotes';
import {
  countsOf,
  EMPTY_SHELL,
  noticesOf,
  type Overview,
  type ShellData,
  type Waiting,
} from './shell-data';

export type { ShellData } from './shell-data';

/**
 * How many ID checks, duplicates and access requests wait, for HR and
 * finance, in parallel. Each is People's own read as the person signed in;
 * one it refuses is left out.
 */
async function waitingFor(roles: ShellData['roles']): Promise<Waiting | null> {
  if (!roles.hr && !roles.finance) return null;
  const [ids, dupes, access] = await Promise.all([
    people<{ items: unknown[] }>('IdentifierReviews'),
    people<{ items: unknown[] }>('Duplicates', { a: null, b: null }),
    people<{ canDecide: boolean; requests: { state: string }[] }>('FullValues'),
  ]);
  return {
    identifiers: ids.ok ? ids.data.items.length : null,
    duplicates: dupes.ok ? dupes.data.items.length : null,
    // Only a decision waits on somebody who can make it; a request of one's
    // own is not something to act on.
    accessRequests:
      access.ok && access.data.canDecide
        ? access.data.requests.filter((r) => r.state === 'pending').length
        : null,
  };
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
  if (!entitlements.includes('module.people')) return EMPTY_SHELL;
  // The roles on their own: People answers this whether or not anything is
  // published yet, which the overview does not.
  const home = people<ShellData['roles']>('Home');
  const [route, overview, waiting] = await Promise.all([
    peopleRoute('/people').catch(() => undefined),
    people<Overview>('Overview'),
    // What waits for HR, asked as soon as the roles say who this is rather
    // than after the overview, which takes twice as long.
    home.then((h) => (h.ok ? waitingFor(h.data) : null)),
  ]);
  const data = overview.ok ? overview.data : null;
  const answered = await home;
  const roles = answered.ok ? answered.data : (data?.roles ?? EMPTY_SHELL.roles);
  if (route === null || route === undefined) return { ...EMPTY_SHELL, roles };
  const places = placesFor(route.nav, roles);
  const counts =
    data === null
      ? null
      : countsOf(data, answered.ok ? waiting : await waitingFor(roles), places.sections);
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
});

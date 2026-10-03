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
  if (!entitlements.includes('module.people')) return EMPTY_SHELL;
  // All at once: the roles on their own (People answers them whether or not
  // anything is published yet, which the overview does not), the overview,
  // and what waits for a decision, which needs nobody's roles to be asked.
  const [route, overview, answered, waiting] = await Promise.all([
    peopleRoute('/people').catch(() => undefined),
    people<Overview>('Overview'),
    people<ShellData['roles']>('Home'),
    waitingFor(),
  ]);
  const data = overview.ok ? overview.data : null;
  const roles = answered.ok ? answered.data : (data?.roles ?? EMPTY_SHELL.roles);
  if (route === null || route === undefined) return { ...EMPTY_SHELL, roles };
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
});

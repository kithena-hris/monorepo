import 'server-only';

import { people } from './people';
import { peopleRoute, placesFor } from './remotes';
import { countsOf, EMPTY_SHELL, noticesOf, type Overview, type ShellData } from './shell-data';

export type { ShellData } from './shell-data';

export async function shellData(entitlements: readonly string[]): Promise<ShellData> {
  if (!entitlements.includes('module.people')) return EMPTY_SHELL;
  const [route, home, overview] = await Promise.all([
    peopleRoute('/people').catch(() => undefined),
    // The roles on their own: People answers this whether or not anything is
    // published yet, which the overview does not.
    people<ShellData['roles']>('Home'),
    people<Overview>('Overview'),
  ]);
  const data = overview.ok ? overview.data : null;
  const roles = home.ok ? home.data : (data?.roles ?? EMPTY_SHELL.roles);
  if (route === null || route === undefined) return { ...EMPTY_SHELL, roles };
  const places = placesFor(route.nav, roles);
  return {
    roles,
    sections: places.sections,
    settings: places.settings,
    counts: data === null ? {} : countsOf(data),
    notices: data === null ? [] : noticesOf(data),
    now: data?.now ?? null,
  };
}

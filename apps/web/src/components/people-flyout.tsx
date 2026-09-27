import type { ReactNode } from 'react';

import { PeopleSections } from './people-nav';
import { people } from '../lib/people';
import { peopleRoute, placesFor } from '../lib/remotes';

/**
 * People's places, hanging off its sidebar item, for a page outside People
 * (home, Settings): the same list the People area shows, cut to this
 * person's roles, so hovering People reads the same wherever you are.
 * Nothing for a company without People, or while People cannot be reached.
 */
export async function peopleFlyout(
  entitlements: readonly string[],
): Promise<Readonly<Record<string, ReactNode>>> {
  if (!entitlements.includes('module.people')) return {};
  const [route, home] = await Promise.all([
    peopleRoute('/people').catch(() => undefined),
    people<{ hr: boolean; admin: boolean; finance: boolean }>('Home'),
  ]);
  if (route === null || route === undefined) return {};
  const places = placesFor(route.nav, home.ok ? home.data : { hr: false, admin: false, finance: false });
  return places.sections.length === 0
    ? {}
    : { '/people': <PeopleSections sections={places.sections} route={null} /> };
}

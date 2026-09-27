import type { JSX } from 'react';

import { PeopleArea, flatSearch } from '../../../../components/people-area';

/**
 * People's settings under Settings: its overview at `/settings/people` and
 * each setting beneath it, rendered by the People remote like any People
 * screen, with Settings › People as the trail.
 */
export default async function PeopleSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  return (
    <PeopleArea
      path={['/settings/people', ...path].join('/')}
      search={await flatSearch(searchParams)}
      area="settings"
    />
  );
}

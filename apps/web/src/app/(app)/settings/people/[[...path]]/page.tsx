import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { PeopleArea, flatSearch } from '../../../../../components/people-area';

/**
 * Each of People's settings under Settings, rendered by the People remote
 * like any People screen, with Settings › People as the trail. The list of
 * them is Settings itself, so `/settings/people` goes there.
 */
export default async function PeopleSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  // People's settings are listed, with what is set now, on Settings itself.
  if (path.length === 0) redirect('/settings');
  return (
    <PeopleArea
      path={['/settings/people', ...path].join('/')}
      search={await flatSearch(searchParams)}
      area="settings"
    />
  );
}

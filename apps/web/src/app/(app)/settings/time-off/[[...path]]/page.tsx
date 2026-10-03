import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { flatSearch } from '../../../../../components/people-area';
import { RemoteArea } from '../../../../../components/remote-area';

/**
 * Each of Time Off's settings under Settings, rendered by the Time Off remote.
 * The list of them is Settings itself, so `/settings/time-off` goes there.
 */
export default async function TimeOffSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  if (path.length === 0) redirect('/settings');
  return (
    <RemoteArea
      path={['/settings/time-off', ...path].join('/')}
      search={await flatSearch(searchParams)}
    />
  );
}

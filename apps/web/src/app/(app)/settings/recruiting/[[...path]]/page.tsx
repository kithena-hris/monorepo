import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { flatSearch } from '../../../../../components/people-area';
import { RemoteArea } from '../../../../../components/remote-area';

/**
 * Each of Recruiting's settings under Settings, rendered by the Recruiting remote.
 * The list of them is Settings itself, so `/settings/recruiting` goes there.
 */
export default async function RecruitingSettingsPage({
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
      path={['/settings/recruiting', ...path].join('/')}
      search={await flatSearch(searchParams)}
    />
  );
}

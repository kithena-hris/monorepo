import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { flatSearch } from '../../../../../components/people-area';
import { RemoteArea } from '../../../../../components/remote-area';

/**
 * Each of Documents's settings under Settings, rendered by the Documents remote.
 * The list of them is Settings itself, so `/settings/documents` goes there.
 */
export default async function DocumentsSettingsPage({
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
      path={['/settings/documents', ...path].join('/')}
      search={await flatSearch(searchParams)}
    />
  );
}

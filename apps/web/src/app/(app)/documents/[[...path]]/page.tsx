import type { JSX } from 'react';

import { flatSearch } from '../../../../components/people-area';
import { RemoteArea } from '../../../../components/remote-area';

/** Everything under `/documents`, rendered by the Documents remote (`RemoteArea`). */
export default async function Documents({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  return (
    <RemoteArea path={['/documents', ...path].join('/')} search={await flatSearch(searchParams)} />
  );
}

import type { JSX } from 'react';

import { flatSearch } from '../../../../components/people-area';
import { RemoteArea } from '../../../../components/remote-area';

/** Everything under `/recruiting`, rendered by the Recruiting remote (`RemoteArea`). */
export default async function Recruiting({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  return (
    <RemoteArea path={['/recruiting', ...path].join('/')} search={await flatSearch(searchParams)} />
  );
}

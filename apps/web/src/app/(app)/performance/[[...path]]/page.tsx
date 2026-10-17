import type { JSX } from 'react';

import { flatSearch } from '../../../../components/people-area';
import { RemoteArea } from '../../../../components/remote-area';

/** Everything under `/performance`, rendered by the Performance remote (`RemoteArea`). */
export default async function Performance({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  return (
    <RemoteArea
      path={['/performance', ...path].join('/')}
      search={await flatSearch(searchParams)}
    />
  );
}

import type { JSX } from 'react';

import { flatSearch } from '../../../../components/people-area';
import { RemoteArea } from '../../../../components/remote-area';

/** Everything under `/time-off`, rendered by the Time Off remote (`RemoteArea`). */
export default async function TimeOff({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  return (
    <RemoteArea path={['/time-off', ...path].join('/')} search={await flatSearch(searchParams)} />
  );
}

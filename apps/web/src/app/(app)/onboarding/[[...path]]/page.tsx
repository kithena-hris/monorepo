import type { JSX } from 'react';

import { flatSearch } from '../../../../components/people-area';
import { RemoteArea } from '../../../../components/remote-area';

/** Everything under `/onboarding`, rendered by the Onboarding remote (`RemoteArea`). */
export default async function Onboarding({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  return (
    <RemoteArea path={['/onboarding', ...path].join('/')} search={await flatSearch(searchParams)} />
  );
}

import type { JSX } from 'react';

import { PeopleArea, flatSearch } from '../../../../components/people-area';

/** Everything under `/people`, rendered by the People remote (`PeopleArea`). */
export default async function People({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { path = [] } = await params;
  return (
    <PeopleArea
      path={['/people', ...path].join('/')}
      search={await flatSearch(searchParams)}
      area="people"
    />
  );
}

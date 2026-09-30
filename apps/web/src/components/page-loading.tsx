'use client';

import { Skeleton } from '@reach/ui';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

import { headerFrame, matchPath } from '../lib/remotes';
import { useShellData } from './app-shell';

/**
 * A page inside the shell while it is fetched: every `loading.tsx` under
 * `(app)`, so a prefetched link shows this on the frame after the click.
 *
 * In the header the page will have, read from the address it is going to,
 * because the boundary that shows it is whichever one the navigation crossed
 * first — the area's, or the section's — and each must draw the destination,
 * not itself. A People screen gets the skeleton it shows while its own code
 * loads (`people-screen.tsx`), from the same `headerFrame` the server gives
 * it: a breadcrumb, and on an umbrella page as many tabs as this viewer
 * opens. So neither the page's arrival nor the screen's moves anything.
 */
export function PageLoading(): JSX.Element {
  const shell = useShellData();
  const pathname = usePathname();
  if (pathname === '/people' || (pathname.startsWith('/people/') && pathname !== '/people/menu')) {
    const frame = headerFrame(
      { sections: shell.sections, actions: shell.actions ?? [] },
      matchPath(shell.routes, pathname)?.path ?? null,
      '/people',
    );
    return (
      <Skeleton
        shape="page"
        label="Loading People"
        breadcrumb={frame.section !== null}
        tabs={frame.tabs?.length ?? 0}
      />
    );
  }
  // A setting's page opens under its trail: Settings › People › Roles.
  return <Skeleton shape="page" label="Loading" breadcrumb={pathname.startsWith('/settings/')} />;
}

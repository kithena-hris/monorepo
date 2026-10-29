'use client';

import { lazy, Suspense, type ComponentProps, type JSX } from 'react';

const Rail = lazy(() =>
  import('./scroll-position').then((m) => ({ default: m.ScrollPositionRail })),
);

/**
 * `ScrollPositionRail` in a chunk of its own, for `DataTable` and
 * `VirtualList`: a page fetches it when one of its lists keeps loading, not
 * with every table it draws. It shows nothing until the reader has scrolled
 * into the list, so nothing waits on the fetch.
 */
export function LazyScrollPositionRail(props: ComponentProps<typeof Rail>): JSX.Element {
  return (
    <Suspense fallback={null}>
      <Rail {...props} />
    </Suspense>
  );
}

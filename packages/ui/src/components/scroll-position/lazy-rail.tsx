'use client';

import { lazy, Suspense, useEffect, useState, type ComponentProps, type JSX } from 'react';

const Rail = lazy(() =>
  import('./scroll-position-rail').then((m) => ({ default: m.ScrollPositionRail })),
);

/**
 * Where the reader is in a list the window scrolls (`ScrollPositionRail`),
 * fetched the first time the window scrolls: it shows nothing before the
 * reader has scrolled into the list, so no page's first load pays for it,
 * and a server render (`renderToString` among them) has nothing to wait for.
 * What `DataTable` and `VirtualList` draw, and a list of its own places first
 * inside its box.
 */
export function LazyScrollPositionRail(props: ComponentProps<typeof Rail>): JSX.Element | null {
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    // Already scrolled (a reload, Back): the rail measures where the list is.
    if (window.scrollY > 0) {
      setWanted(true);
      return undefined;
    }
    const want = (): void => {
      setWanted(true);
    };
    window.addEventListener('scroll', want, { once: true, passive: true });
    return () => {
      window.removeEventListener('scroll', want);
    };
  }, []);
  return wanted ? (
    <Suspense fallback={null}>
      <Rail {...props} />
    </Suspense>
  ) : null;
}

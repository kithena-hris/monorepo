'use client';

import { lazy, Suspense, type JSX } from 'react';

import type { InboxScreenProps } from './screen';

/*
 * The Inbox's screen as its own chunk. The sidebar's link prefetches this
 * route on every page, and what a prefetch fetches counts toward each page's
 * first load (`acceptance/perf.acceptance.test.ts`, the budgets). The server
 * still draws it into the first HTML; the sidebar's count (`bell.tsx`) fetches
 * its code once a page's own is in, so opening the Inbox waits on nothing.
 */
export const loadInboxScreen = (): Promise<typeof import('./screen')> => import('./screen');
const Screen = lazy(() => loadInboxScreen().then((m) => ({ default: m.InboxScreen })));

export function InboxScreen(props: InboxScreenProps): JSX.Element {
  return (
    <Suspense fallback={null}>
      <Screen {...props} />
    </Suspense>
  );
}

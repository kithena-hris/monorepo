'use client';

import { useRouter } from 'next/navigation';
// The value behind `router.prefetch`'s `kind`, which `next/navigation` types
// but does not export.
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { useEffect } from 'react';

import { DIRECTORY_VIEWS, viewHref } from './shortcuts';
import { currentPlace, matchPath, type Place } from './remotes';

type Router = ReturnType<typeof useRouter>;

/**
 * Fetch a page whole — its server-rendered screen and the data it is drawn
 * from — so a press on its link draws it from what the browser already holds.
 *
 * Every page here is dynamic, and Next prefetches a dynamic page only down to
 * its nearest `loading.js`, of which there are none: a plain `Link` or
 * `router.prefetch(href)` fetched nothing a click could use, and every click
 * waited for the server (`node_modules/next/dist/docs/01-app/02-guides/
 * prefetching.md`). A full prefetch is kept for `staleTimes.static`
 * (`next.config.mjs`) and dropped by every write (`changed` in `people.ts`).
 */
export function prefetchPage(router: Router, href: string): void {
  router.prefetch(href, { kind: PrefetchKind.FULL });
}

/**
 * Where a press on a plain link should go without leaving the page: a plain
 * left click on a same-origin link that opens in this tab. `null` for
 * anything the browser should handle itself — a modified click (a new tab),
 * a download, another origin, or a click something already handled (a Next
 * `Link` has, by the time this sees it).
 */
export function inAppHref(event: MouseEvent, origin: string): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  return inAppLink(event.target, origin);
}

/** The in-app address of the link `target` is in, or null: another origin, a new tab, a file. */
function inAppLink(target: EventTarget | null, origin: string): string | null {
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  if (link === null || link.hasAttribute('download')) return null;
  if (link.target !== '' && link.target !== '_self') return null;
  const url = new URL(link.href, origin);
  return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
}

/**
 * Every plain `<a href>` on the page follows the router rather than loading
 * the page again.
 *
 * A remote renders plain links: it cannot know the host's router, and it must
 * work in a host that has none. Neither can a `NotificationItem` or a list row
 * drawn by a server component. Listening on the document rather than around
 * the remote's screen matters: a remote's breadcrumb switcher and menus are
 * portalled to `<body>`, outside any container, and their links were full
 * page loads. Registered after React's own listener on the same node, so a
 * `Link` has already called `preventDefault` and is left alone.
 *
 * A path that is not a page (a file, a route handler) still works: the router
 * finds no page there and loads it the ordinary way.
 *
 * And each is prefetched whole (`prefetchPage`) on hover, focus or the start
 * of a touch — a remote's link, a `Link` in the sidebar, the rail's flyout or
 * the phone's menu alike — so the press that follows draws the next page from
 * what is already here. On intent rather than on sight: every prefetch is a
 * page rendered on the server, and a screen full of rows would be a storm.
 * Only where `isPage` says there is a page: prefetching a route handler would
 * run it — a download, an export — on a hover.
 */
export function useInAppLinks(isPage: (path: string) => boolean): void {
  const router = useRouter();
  useEffect(() => {
    const follow = (event: MouseEvent): void => {
      const href = inAppHref(event, window.location.origin);
      if (href === null) return;
      event.preventDefault();
      router.push(href);
    };
    let warmed: string | null = null;
    const warm = (event: Event): void => {
      const href = inAppLink(event.target, window.location.origin);
      if (href === null || href === warmed) return;
      warmed = href;
      if (isPage(new URL(href, window.location.origin).pathname)) prefetchPage(router, href);
    };
    document.addEventListener('click', follow);
    for (const type of ['pointerover', 'focusin', 'touchstart'] as const) {
      document.addEventListener(type, warm, { passive: true });
    }
    return () => {
      document.removeEventListener('click', follow);
      for (const type of ['pointerover', 'focusin', 'touchstart'] as const) {
        document.removeEventListener(type, warm);
      }
    };
  }, [router, isPage]);
}

/** An area's places and routes, as the shell holds them, for `pagesToWarm`. */
export interface WarmArea {
  readonly places: readonly Place[];
  readonly routes: readonly string[];
}

/**
 * The pages one press from here worth fetching before anybody points at
 * them: the other tabs of the place this page is under (Review's queues,
 * Insights' charts, Organisation's settings) and, in the Directory, its other
 * views with the search and filters the address holds. Most are drawn from
 * the answer this page was, so each costs the server little. Not the
 * sidebar's sections: each is a screen with reads of its own, fetched on
 * intent (`useInAppLinks`).
 */
export function pagesToWarm(pathname: string, search: string, areas: readonly WarmArea[]): string[] {
  const pages = new Set<string>();
  for (const { places, routes } of areas) {
    const route = matchPath(routes, pathname)?.path ?? null;
    if (route === null) continue;
    for (const tab of currentPlace(places, route)?.tabs ?? []) {
      if (!tab.path.includes('/:')) pages.add(tab.path);
    }
    if (route.startsWith('/people/directory/')) {
      for (const view of DIRECTORY_VIEWS) {
        if (`/people/directory/${view}` !== route) pages.add(viewHref(view, search));
      }
    }
  }
  pages.delete(pathname);
  return [...pages];
}

/**
 * Fetch `pagesToWarm` whole once each page has settled — when the browser is
 * next idle — so it never competes with the page arriving. Next queues the
 * prefetches and skips one it already holds.
 */
export function useWarmPages(pathname: string, areas: readonly WarmArea[]): void {
  const router = useRouter();
  useEffect(() => {
    const pages = pagesToWarm(pathname, window.location.search, areas);
    if (pages.length === 0) return;
    const warm = (): void => {
      for (const href of pages) prefetchPage(router, href);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => {
        window.cancelIdleCallback(id);
      };
    }
    const id = setTimeout(warm, 300);
    return () => {
      clearTimeout(id);
    };
  }, [router, pathname, areas]);
}

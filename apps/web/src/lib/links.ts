'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

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
 * And each is prefetched as a `Link` would be, on hover, focus or the start
 * of a touch, so a press on a remote's tab or row shows the next page's
 * skeleton at once. Only where `isPage` says there is a page: prefetching a
 * route handler would run it — a download, an export — on a hover.
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
      if (isPage(new URL(href, window.location.origin).pathname)) router.prefetch(href);
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

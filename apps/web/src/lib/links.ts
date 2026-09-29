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
  const target = event.target;
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
 */
export function useInAppLinks(): void {
  const router = useRouter();
  useEffect(() => {
    const follow = (event: MouseEvent): void => {
      const href = inAppHref(event, window.location.origin);
      if (href === null) return;
      event.preventDefault();
      router.push(href);
    };
    document.addEventListener('click', follow);
    return () => {
      document.removeEventListener('click', follow);
    };
  }, [router]);
}

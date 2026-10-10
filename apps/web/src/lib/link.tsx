import NextLink from 'next/link';
import type { ComponentProps, JSX } from 'react';

/**
 * A Next `Link` that does not prefetch when it scrolls into view.
 *
 * Every page here is dynamic with no `loading.js`, so Next's on-sight
 * prefetch renders a page on the server for nothing a click can use
 * (`links.ts`), once per sidebar link, and again each time the address
 * changes under it. The shell prefetches a page whole on intent instead —
 * hover, focus, the start of a touch (`useInAppLinks`) — which this leaves
 * alone.
 */
export function Link(props: ComponentProps<typeof NextLink>): JSX.Element {
  return <NextLink prefetch={false} {...props} />;
}

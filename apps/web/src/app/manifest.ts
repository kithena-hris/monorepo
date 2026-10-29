import type { MetadataRoute } from 'next';

import { THEME_COLOR } from '../lib/theme';

/**
 * Kithena, installable: from the browser's menu on a desk, or "Add to Home
 * Screen" on a phone, it opens in a window of its own at its home page,
 * with no address bar. The icon is the phone app's (`apps/tenant-mobile`),
 * whose mark sits inside the safe zone, so it serves as maskable too.
 *
 * Public (`proxy.ts`): a browser fetches the manifest and its icons without
 * the session's cookie.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kithena',
    short_name: 'Kithena',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Dark until the page says otherwise: the window opens in the app's dark
    // canvas, then takes the page's own `theme-color` (`app/layout.tsx`).
    background_color: THEME_COLOR.dark,
    theme_color: THEME_COLOR.dark,
    icons: [
      { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

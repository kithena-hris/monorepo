import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-vite';

const reachFavicon = readFileSync(fileURLToPath(new URL('./favicon.svg', import.meta.url)), 'utf8');

const config: StorybookConfig = {
  // Stories live next to the components they document, in `@reach/ui`. This app
  // is only the host: it owns the theming, the a11y run and the build, and owns
  // no component of its own.
  //
  // The globs stay relative to this directory, the Vitest integration resolves
  // them against `configDir`, and an absolute path silently produces an
  // unmatchable pattern there.
  stories: [
    './welcome.mdx',
    // `!(kithena)` is an extglob on the *filename*. A separate `'!...'` entry in
    // this array does not work: Storybook treats each entry as an independent
    // specifier rather than passing the set to globby, so a negation line is
    // matched as a literal path and silently keeps the file.
    '../../../packages/ui/src/**/!(kithena).stories.@(ts|tsx)',
    /*
     * Everything except Kithena's mark.
     *
     * Reach is sold and documented on its own, and this Storybook is that
     * documentation. Publishing the Kithena logo, its construction grid and its
     * misuse rules inside it tells every reader that Reach belongs to one
     * product, which is the thing the whole boundary exists to prevent, and it
     * put the Kithena brand on a public URL when this was deployed.
     *
     * The component stays in `packages/ui/src/brand`, where the tech-stack
     * decision puts both marks, because a mark is presentation and nothing
     * else. Only the *documentation* of it moves out of Reach's own docs. Its
     * home is a Kithena surface, `apps/admin` or `apps/web`.
     */
  ],
  addons: [
    '@storybook/addon-docs',
    // Runs axe on every story render. A component that fails here does not ship.
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    // `react-docgen`, not `react-docgen-typescript`: the latter loads the
    // TypeScript compiler through its internal API, which TypeScript 7 no
    // longer exposes, and crashes on load. `react-docgen` reads the source and
    // the JSDoc directly, so prop tables still come from the implementation,
    // the argTypes in each story fill in descriptions and grouping.
    reactDocgen: 'react-docgen',
  },
  docs: { defaultName: 'Overview' },
  core: { disableTelemetry: true },

  // The browser tab. Storybook has no built-in title setting, so the manager
  // head is where the name goes.
  // The tab. Storybook has no title setting, and the favicon it ships is its
  // own, so both are replaced here. The SVG is inlined rather than served from
  // a static directory so there is one fewer path to get wrong.
  // Only the favicon here. The title and the sidebar brand live in
  // `manager.ts`, because a second `<title>` appended to the head is ignored.
  managerHead: (head) =>
    `${head ?? ''}<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(reachFavicon)}">`,

  /**
   * The theme is applied before the first paint, not after it.
   *
   * `preview.tsx` sets the `dark` class from the channel, which is JavaScript
   * that runs after the document has already painted. Navigating between
   * stories in dark mode therefore showed a white frame and then corrected
   * itself, every time.
   *
   * This script is inline and blocking, so it runs before anything renders. It
   * reads the theme out of the iframe's own URL, which is where Storybook puts
   * the globals, and it sets `color-scheme` as well as the class: the class
   * needs the design system's stylesheet to mean anything, and `color-scheme`
   * tells the browser what to paint the canvas in the moment before that
   * stylesheet arrives.
   */
  previewHead: (head) =>
    `${head ?? ''}<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(reachFavicon)}">` +
    `<script>(function(){try{` +
    `var g=new URLSearchParams(location.search).get('globals')||'';` +
    `var m=/(?:^|;)theme:([^;]*)/.exec(g);` +
    `var dark=m?m[1]==='dark':false;` +
    `if(dark){document.documentElement.classList.add('dark');}` +
    `document.documentElement.style.colorScheme=dark?'dark':'light';` +
    `}catch(e){}})();</script>`,
};

export default config;

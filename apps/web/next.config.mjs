import { join } from 'node:path';

// Deliberately `.mjs`, not `.ts`: Next loads a TypeScript config through the
// installed `typescript` package's compiler API, which TypeScript 7 does not
// expose, and the load fails before the build starts. JSDoc types give the same
// checking here without the dependency.

/** @type {import('next').NextConfig} */
const config = {
  // `@reach/ui` ships TypeScript source rather than build output, so Next
  // compiles it with the app. One compiler, one set of settings, and no
  // watch-and-rebuild step between editing a component and seeing it here.
  transpilePackages: ['@reach/ui'],
  typedRoutes: true,
  // Types are checked once, by `pnpm typecheck` and the authoritative TS 6
  // pass. Next repeating it in the build makes the slow step slower and can
  // disagree with the gate.
  typescript: { ignoreBuildErrors: true },
  // Linting likewise belongs to `pnpm lint`, which runs oxlint and the
  // type-aware pass over the whole repo rather than one app.
  eslint: { ignoreDuringBuilds: true },
  // The workspace root, so file tracing stops walking up into unrelated
  // lockfiles above the repo.
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  // The renderer process's bundle is read from disk, not imported, so tracing
  // cannot find it on its own (PEO-115, `src/lib/remote-render.ts`). Every
  // route that renders a remote on the server needs it beside it: Home (People's
  // home slot), People, Time Off and both areas' settings. A route without it
  // still works, drawn in the browser, which is why its absence went unnoticed.
  outputFileTracingIncludes: {
    '/': ['./.renderer/renderer.cjs'],
    '/people/\\[\\[\\.\\.\\.path\\]\\]': ['./.renderer/renderer.cjs'],
    '/time-off/\\[\\[\\.\\.\\.path\\]\\]': ['./.renderer/renderer.cjs'],
    '/settings/people/\\[\\[\\.\\.\\.path\\]\\]': ['./.renderer/renderer.cjs'],
    '/settings/time-off/\\[\\[\\.\\.\\.path\\]\\]': ['./.renderer/renderer.cjs'],
  },
  experimental: {
    optimizePackageImports: ['@reach/ui', 'lucide-react'],
    // A page visited in the last thirty seconds is shown from the browser's
    // copy, so Back and a second click draw at once. A page prefetched whole
    // (`prefetchPage` in `src/lib/links.ts`: the tabs beside this one, any
    // link pointed at) is kept for a minute, its data with it: long enough to
    // be there when the press comes, short enough that what somebody else
    // changed shows on the next visit. Every write drops the lot (`changed`
    // in `src/lib/people.ts`), so nothing stale outlives a save.
    staleTimes: { dynamic: 30, static: 60 },
    // No file passes through a server action: an import's goes from the
    // browser straight to storage (PRD §14.2), so the 1 MB default stands —
    // and a Vercel function refuses more than 4.5 MB whatever this says.
  },
};

export default config;

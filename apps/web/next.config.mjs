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
  experimental: {
    optimizePackageImports: ['@reach/ui', 'lucide-react'],
  },
};

export default config;

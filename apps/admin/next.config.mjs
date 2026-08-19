import { join } from 'node:path';

// See the note in apps/web/next.config.mjs for why this is not a .ts file.

/** @type {import('next').NextConfig} */
const config = {
  // Back-office runs on the same design system as the product. An internal
  // tool that looks different is an internal tool nobody trusts the state of.
  transpilePackages: ['@reach/ui'],
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

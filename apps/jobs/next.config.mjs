import { join } from 'node:path';

// See the note in apps/web/next.config.mjs for why this is not a .ts file.

/** @type {import('next').NextConfig} */
const config = {
  // Kithena Jobs is Reach, as every Kithena screen is.
  transpilePackages: ['@reach/ui'],
  // Types and lint are the repo's gates, not the build's (apps/admin's note).
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  experimental: {
    optimizePackageImports: ['@reach/ui', 'lucide-react'],
  },
};

export default config;

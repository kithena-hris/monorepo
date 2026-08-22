/**
 * Tailwind v4 runs as a PostCSS plugin.
 *
 * Without this the stylesheet is imported, the tokens arrive, and every utility
 * class in the markup resolves to nothing — the page renders as unstyled text
 * and no build step complains. `apps/admin` and `apps/auth/shell` each needed
 * this file for the same reason and each was missing it at some point; this app
 * was the last one, and it went unnoticed because it has never been deployed.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

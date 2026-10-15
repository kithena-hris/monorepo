/**
 * Tailwind v4 runs as a PostCSS plugin.
 *
 * Without this the stylesheet is imported, the tokens arrive, and every utility
 * class in the markup resolves to nothing — the page renders as unstyled text
 * and no build step complains. `apps/auth/shell` needed the same file for the
 * same reason; `apps/docs` avoids it by using `@tailwindcss/vite` instead.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

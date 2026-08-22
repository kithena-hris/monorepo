/**
 * Tailwind v4 runs as a PostCSS plugin here.
 *
 * `apps/docs` uses `@tailwindcss/vite` and `apps/web` lets Next find
 * `@tailwindcss/postcss` on its own. Rspack needs to be told, and this is the
 * telling — without it the stylesheet is imported, the tokens arrive, and every
 * utility class in the markup resolves to nothing. The page renders as unstyled
 * text and nothing errors, which is the failure mode worth naming.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

/**
 * The Reach mark as a data URI, for the handful of places that need the logo
 * as a URL rather than as a React element: a favicon link, a `<meta>` image,
 * Storybook's `brandImage`.
 *
 * The markup is written out here rather than read from `assets/reach-mark.svg`
 * because two of those consumers are browser bundles, and a browser bundle
 * cannot open a file. `mark-data-uri.test.ts` compares this against the asset
 * on disk, so the duplication cannot drift silently.
 */

/** Brand 600. The mark inherits `currentColor` everywhere else; a data URI has
 *  no surrounding document to inherit from, so the colour is fixed here. */
const INK = '#5b5bd6';

const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"',
  ` stroke="${INK}" stroke-width="2.6" stroke-linecap="round"`,
  ' role="img" aria-label="Reach">',
  '<path d="M6 20 V13 C6 8 10 4.6 14.2 6.2"/>',
  `<circle cx="18.5" cy="7.8" r="1.9" fill="${INK}" stroke="none"/>`,
  '</svg>',
].join('');

/**
 * Percent-encoded rather than base64: it stays readable in a stylesheet or a
 * DOM inspector, and it is shorter for markup this small. `#` has to go because
 * a raw one starts the fragment and truncates the URI.
 */
export const reachMarkDataUri = `data:image/svg+xml,${SVG.replace(/#/g, '%23')
  .replace(/"/g, "'")
  .replace(/</g, '%3C')
  .replace(/>/g, '%3E')}`;

/**
 * The Kithena mark as a data URI, for the places that need the logo as a URL
 * rather than as a React element: a favicon link, a `<meta>` image, an app
 * manifest icon.
 *
 * The markup is written out here rather than read from
 * `assets/kithena-mark.svg` because those consumers are browser bundles, and a
 * browser bundle cannot open a file. `kithena-mark-data-uri.test.ts` compares
 * this against the asset on disk, so the duplication cannot drift silently.
 *
 * This is the compact cut deliberately. Everywhere a data URI is used, the mark
 * is rendered small — a 16px tab icon, a 32px manifest entry — and the standard
 * cut's weave closes at that size. The compact cut carries a heavier stroke and
 * wider breaks, which is the difference between three woven rings and a smudge.
 */

/** Brand 600. The mark inherits `currentColor` everywhere else; a data URI has
 *  no surrounding document to inherit from, so the colour is fixed here. */
const INK = '#5b5bd6';

const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"',
  ` stroke="${INK}" stroke-width="2.8" stroke-linecap="round"`,
  ' role="img" aria-label="Kithena">',
  '<path d="M12.71 14.46 A6.4 6.4 0 0 1 6.14 10.66"/>',
  '<path d="M5.98 5.92 A6.4 6.4 0 1 1 16.90 12.22"/>',
  '<path d="M9.51 11.39 A6.4 6.4 0 0 1 16.09 7.59"/>',
  '<path d="M20.27 9.83 A6.4 6.4 0 1 1 9.36 16.13"/>',
  '<path d="M7.91 7.59 A6.4 6.4 0 0 1 14.49 11.39"/>',
  '<path d="M14.64 16.13 A6.4 6.4 0 1 1 3.73 9.83"/>',
  '</svg>',
].join('');

/**
 * Percent-encoded rather than base64: it stays readable in a stylesheet or a
 * DOM inspector, and it is shorter for markup this small. `#` has to go because
 * a raw one starts the fragment and truncates the URI.
 */
export const kithenaMarkDataUri = `data:image/svg+xml,${SVG.replace(/#/g, '%23')
  .replace(/"/g, "'")
  .replace(/</g, '%3C')
  .replace(/>/g, '%3E')}`;

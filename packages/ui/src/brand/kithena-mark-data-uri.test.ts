import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { kithenaMarkDataUri } from './kithena-mark-data-uri';

/**
 * `kithena-mark-data-uri.ts` restates the mark's geometry because browser
 * bundles cannot read `assets/kithena-mark-compact.svg`. This is what stops the
 * two copies drifting: edit the asset without editing the constant and the logo
 * would quietly differ between the app and the favicon, which nobody would
 * notice until it shipped.
 *
 * The stakes are higher here than for Reach. That mark is two shapes; this one
 * is six arcs whose endpoints come from circle-circle intersections, so a
 * hand-edited copy is not something anyone would spot by eye.
 */
// Resolved from the working directory, not from `import.meta.url`: under
// Vitest that URL is served over http and `fileURLToPath` rejects it. Both
// `pnpm test` and Turbo run with the package root as cwd.
const asset = readFileSync(
  resolve(process.cwd(), 'src/brand/assets/kithena-mark-compact.svg'),
  'utf8',
);

/** Geometry only. Colour differs on purpose: the asset inherits `currentColor`
 *  from the document, and a data URI has no document to inherit from. */
function geometry(svg: string): string[] {
  return [...svg.matchAll(/(?:d|viewBox|stroke-width)='?"?([^'"]+)['"]/g)].map((m) => m[1] ?? '');
}

describe('kithenaMarkDataUri', () => {
  it('carries the same geometry as the compact SVG asset', () => {
    const decoded = decodeURIComponent(kithenaMarkDataUri.replace('data:image/svg+xml,', ''));
    expect(geometry(decoded)).toEqual(geometry(asset));
  });

  it('uses the compact cut, not the standard one', () => {
    // The standard cut is radius 7 with a 2.2 stroke and closes up at the sizes
    // a data URI is used at. Guarding the stroke and one radius is enough to
    // catch a paste of the wrong constant: the two cuts share no numbers.
    const decoded = decodeURIComponent(kithenaMarkDataUri);
    expect(decoded).toContain("stroke-width='2.8'");
    expect(decoded).toContain('A6.4 6.4');
    expect(decoded).not.toContain('A7 7');
  });

  it('escapes the characters that would truncate it in a url()', () => {
    // A raw `#` opens the fragment; a raw `<` or `>` breaks an inline style
    // attribute. Either one silently yields a broken image rather than an error.
    expect(kithenaMarkDataUri).not.toMatch(/[#<>]/);
  });
});

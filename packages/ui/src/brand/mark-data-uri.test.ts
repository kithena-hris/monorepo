import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { reachMarkDataUri } from './mark-data-uri';

/**
 * `mark-data-uri.ts` restates the mark's geometry because browser bundles
 * cannot read `assets/reach-mark.svg`. This is the thing that stops the two
 * copies drifting: edit the asset without editing the constant and the logo
 * would quietly differ between the app and the favicon, which nobody would
 * notice until it shipped.
 */
// Resolved from the working directory, not from `import.meta.url`: under
// Vitest that URL is served over http and `fileURLToPath` rejects it. Both
// `pnpm test` and Turbo run with the package root as cwd.
const asset = readFileSync(resolve(process.cwd(), 'src/brand/assets/reach-mark.svg'), 'utf8');

/** Geometry only. Colour differs on purpose: the asset inherits `currentColor`
 *  from the document, and a data URI has no document to inherit from. */
function geometry(svg: string): string[] {
  return [...svg.matchAll(/(?:d|cx|cy|r|viewBox|stroke-width)='?"?([^'"]+)['"]/g)].map(
    (m) => m[1] ?? '',
  );
}

describe('reachMarkDataUri', () => {
  it('carries the same geometry as the SVG asset', () => {
    const decoded = decodeURIComponent(reachMarkDataUri.replace('data:image/svg+xml,', ''));
    expect(geometry(decoded)).toEqual(geometry(asset));
  });

  it('escapes the characters that would truncate it in a url()', () => {
    // A raw `#` opens the fragment; a raw `<` or `>` breaks an inline style
    // attribute. Either one silently yields a broken image rather than an error.
    expect(reachMarkDataUri).not.toMatch(/[#<>]/);
  });
});

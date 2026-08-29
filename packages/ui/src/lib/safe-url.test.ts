import { describe, expect, it } from 'vitest';

import { safeImageUrl, safeLinkUrl } from './safe-url';

/*
 * These guards stand between stored data and a DOM sink, and they had no tests
 * until CodeQL flagged an `<img src>` that was not using them. The value of a
 * fail-closed helper is entirely in the cases it refuses, so those are what is
 * written down here.
 */

describe('safeImageUrl', () => {
  it('allows the schemes a picture legitimately arrives on', () => {
    for (const url of [
      'https://abc.public.blob.vercel-storage.com/logo.png',
      'http://example.test/logo.png',
      // Minted by `URL.createObjectURL`, which only the same document can do.
      'blob:https://app.kithena.com/9f1c-4d2a',
      'data:image/png;base64,iVBORw0KGgo=',
      '/logo.png',
      './logo.png',
      '../logo.png',
    ]) {
      expect(safeImageUrl(url), url).toBe(url);
    }
  });

  it('refuses anything that could execute', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      // A `data:` that is not an image is a document, and a document runs.
      'data:text/html,<script>alert(1)</script>',
      'data:image/png',
    ]) {
      expect(safeImageUrl(url), url).toBeUndefined();
    }
  });

  /*
   * `//evil.test/x` inherits the page's scheme and is a *remote* URL wearing
   * something that looks like a path. It is refused for the reason the module
   * gives: a foreign `src` is a tracking pixel that arrived through our own
   * database, once per render, with every viewer's address on it.
   */
  it('refuses a protocol-relative URL that looks like a path', () => {
    expect(safeImageUrl('//evil.test/pixel.gif')).toBeUndefined();
  });

  it('refuses nothing at all', () => {
    expect(safeImageUrl('')).toBeUndefined();
    expect(safeImageUrl('   ')).toBeUndefined();
    expect(safeImageUrl(null)).toBeUndefined();
    expect(safeImageUrl(undefined)).toBeUndefined();
  });
});

describe('safeLinkUrl', () => {
  it('allows what hands off to another application', () => {
    expect(safeLinkUrl('mailto:ada@example.test')).toBe('mailto:ada@example.test');
    expect(safeLinkUrl('tel:+441234567890')).toBe('tel:+441234567890');
    expect(safeLinkUrl('#section')).toBe('#section');
  });

  /*
   * Stricter than the image guard, and this is the difference worth asserting:
   * a `data:text/html` document opens carrying this origin's referrer and then
   * renders whatever it likes.
   */
  it('refuses a data: URL even when the image guard would allow one', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(safeImageUrl(png)).toBe(png);
    expect(safeLinkUrl(png)).toBeUndefined();
  });

  it('refuses anything that could execute on click', () => {
    for (const url of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
      expect(safeLinkUrl(url), url).toBeUndefined();
    }
  });
});

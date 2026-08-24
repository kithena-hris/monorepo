import { describe, expect, it } from 'vitest';

import { escapeHtml, safeHref, safeImageSrc } from './markup.js';

describe('escapeHtml', () => {
  it('neutralises a tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes the ampersand exactly once', () => {
    // The ordering test. Escaping `&` last would turn the `&` this function
    // just introduced into `&amp;amp;`, and the reader would see `&lt;` on
    // their screen where a `<` belongs.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('Ben & Jerry')).toBe('Ben &amp; Jerry');
  });

  it('escapes both quotes, so an attribute cannot be closed early', () => {
    expect(escapeHtml('" onmouseover="x')).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml("' onmouseover='x")).toBe('&#39; onmouseover=&#39;x');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Acme Corporación')).toBe('Acme Corporación');
  });
});

describe('safeHref', () => {
  it('escapes the ampersands a query string is made of', () => {
    // The enrol link carries four parameters. Unescaped, `&token=` is a
    // character entity as far as the parser is concerned, and the button leads
    // somewhere subtly different from the plain-text link beside it.
    expect(safeHref('https://auth.example/enrol?tenant=acme&token=abc')).toBe(
      'https://auth.example/enrol?tenant=acme&amp;token=abc',
    );
  });

  it('refuses a scheme that runs code', () => {
    // Escaping is not enough here: `javascript:alert(1)` survives escaping
    // intact and is honoured by more mail previews than anyone would like.
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('refuses something that is not a URL at all', () => {
    expect(safeHref('/enrol?token=abc')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});

describe('safeImageSrc', () => {
  it('accepts a hosted mark', () => {
    expect(safeImageSrc('https://x.public.blob.vercel-storage.com/acme.png')).toBe(
      'https://x.public.blob.vercel-storage.com/acme.png',
    );
  });

  it('refuses a data URI, because Gmail will not render one', () => {
    // Not a security rule — a delivery one. The seed script's placeholder logo
    // is exactly this, so without the check it would have looked fine locally
    // and been a broken-image box in every real inbox.
    expect(safeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
  });

  it('refuses an insecure source, which clients drop as mixed content', () => {
    expect(safeImageSrc('http://acme.example/logo.png')).toBeNull();
  });

  it('passes a missing logo straight through', () => {
    expect(safeImageSrc(null)).toBeNull();
    expect(safeImageSrc('')).toBeNull();
  });

  it('escapes a source before it reaches an attribute', () => {
    expect(safeImageSrc('https://acme.example/a.png?a=1&b=2')).toBe(
      'https://acme.example/a.png?a=1&amp;b=2',
    );
  });
});

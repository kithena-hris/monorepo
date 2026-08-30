import { describe, expect, it } from 'vitest';

import { imageIsOurs, type ImageHostPolicy } from './image-host.js';

/** What production runs today: any bucket subdomain of the Blob host. */
const blob: ImageHostPolicy = { hosts: ['.public.blob.vercel-storage.com'] };

describe('imageIsOurs', () => {
  it('accepts a bucket on an allowed suffix', () => {
    expect(imageIsOurs('https://abc123.public.blob.vercel-storage.com/logo.png', blob)).toBe(true);
  });

  it('accepts no image at all', () => {
    // Absent is not the same as elsewhere. A company with no logo is ordinary.
    expect(imageIsOurs(null, blob)).toBe(true);
  });

  /*
   * The rule this exists for. A customer's login page renders these, so an
   * off-site URL is an image somebody else can swap after we approved it — on
   * the one screen where a swapped image is a convincing phishing prompt.
   */
  it('refuses a host we do not control', () => {
    expect(imageIsOurs('https://evil.example/logo.png', blob)).toBe(false);
  });

  /*
   * The failure a plain string check invites. `vercel-storage.com.evil.example`
   * *contains* the allowed host, and a `String.includes` or a loose regex says
   * yes. Parsing and comparing the host is what makes that impossible.
   */
  it('refuses a host that merely contains an allowed one', () => {
    for (const url of [
      'https://public.blob.vercel-storage.com.evil.example/logo.png',
      'https://evil.example/public.blob.vercel-storage.com/logo.png',
      'https://evil.example/?x=.public.blob.vercel-storage.com',
      'https://evil.example#.public.blob.vercel-storage.com',
    ]) {
      expect(imageIsOurs(url, blob), url).toBe(false);
    }
  });

  it('refuses a suffix match that is not on a label boundary', () => {
    // `notpublic.blob…` ends with the allowed string only if you ignore where
    // the dots are, which is how a suffix check becomes a hole.
    expect(imageIsOurs('https://x.notpublic.blob.vercel-storage.com/l.png', blob)).toBe(false);
  });

  it('refuses anything that is not https', () => {
    for (const url of [
      'http://abc.public.blob.vercel-storage.com/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      '//abc.public.blob.vercel-storage.com/logo.png',
      'not a url at all',
    ]) {
      expect(imageIsOurs(url, blob), url).toBe(false);
    }
  });

  /*
   * The reason this is configuration rather than a literal. Self-hosting swaps
   * the bucket for one we run; the rule does not change, only the host it names.
   */
  it('takes an exact host as well as a suffix', () => {
    const own: ImageHostPolicy = { hosts: ['images.kithena.com'] };
    expect(imageIsOurs('https://images.kithena.com/logo.png', own)).toBe(true);
    // Exact means exact: a subdomain of it is a different host.
    expect(imageIsOurs('https://evil.images.kithena.com/logo.png', own)).toBe(false);
  });

  it('accepts an image on any of several allowed hosts', () => {
    const during = { hosts: ['.public.blob.vercel-storage.com', 'images.kithena.com'] };
    expect(imageIsOurs('https://a.public.blob.vercel-storage.com/l.png', during)).toBe(true);
    expect(imageIsOurs('https://images.kithena.com/l.png', during)).toBe(true);
    expect(imageIsOurs('https://elsewhere.example/l.png', during)).toBe(false);
  });

  /*
   * An empty policy refuses every image rather than allowing every image. A
   * misconfigured deployment should lose logos, not gain an open redirect for
   * whatever anybody types.
   */
  it('refuses everything when no host is configured', () => {
    expect(imageIsOurs('https://abc.public.blob.vercel-storage.com/l.png', { hosts: [] })).toBe(
      false,
    );
    expect(imageIsOurs(null, { hosts: [] })).toBe(true);
  });

  it('ignores the case of the host, as DNS does', () => {
    expect(imageIsOurs('https://ABC.Public.Blob.Vercel-Storage.COM/l.png', blob)).toBe(true);
  });
});

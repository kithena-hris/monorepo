import { describe, expect, it } from 'vitest';

import { ceremonyOrigin } from './ceremony-origin';

/**
 * The regression this file exists for.
 *
 * Passkey sign-in on a company's own hostname was refused every time, and the
 * reason was one line: the route sent `new URL(request.url).origin`, which Next
 * rebuilds from the address the server is bound to rather than from the
 * request's `Host`. A ceremony at `acme.app.localhost:3000` reached identity as
 * `http://localhost:3000` — an origin that does not end in the relying-party id
 * — and was correctly rejected by a check doing its job on a wrong input.
 *
 * So the first test is the whole point: the tenant label survives.
 */
const headers = (entries: Record<string, string>): Headers => new Headers(entries);

describe('ceremonyOrigin', () => {
  it('keeps the tenant label that request.url loses', () => {
    expect(ceremonyOrigin(headers({ host: 'acme.app.localhost:3000' }))).toBe(
      'http://acme.app.localhost:3000',
    );
  });

  it('keeps the port, because an origin without one is a different origin', () => {
    // The authenticator signs over the origin including its port. Dropping it
    // would produce a string that looks right and matches nothing.
    expect(ceremonyOrigin(headers({ host: 'acme.app.localhost:3000' }))).toContain(':3000');
  });

  it('uses the scheme the browser spoke, not the one this process received', () => {
    // Behind a proxy the inbound connection is plain HTTP while the browser's
    // was HTTPS. An origin claiming `http` there would never match.
    expect(
      ceremonyOrigin(
        headers({ host: 'acme.app.kithena.com', 'x-forwarded-proto': 'https' }),
      ),
    ).toBe('https://acme.app.kithena.com');
  });

  it('reads only the first hop of a forwarded chain', () => {
    // Two proxies append, and the entry that describes the browser's connection
    // is the first. Reading the last would report the hop nearest to us.
    expect(
      ceremonyOrigin(headers({ host: 'acme.app.kithena.com', 'x-forwarded-proto': 'https, http' })),
    ).toBe('https://acme.app.kithena.com');
  });

  it('treats anything other than https as http rather than trusting it', () => {
    // The header is caller-supplied. `javascript` is not a scheme this may
    // emit, whatever a client asks for.
    expect(
      ceremonyOrigin(headers({ host: 'acme.app.localhost:3000', 'x-forwarded-proto': 'javascript' })),
    ).toBe('http://acme.app.localhost:3000');
  });

  it('refuses to invent an origin when there is no host', () => {
    // Null, never a placeholder. A guessed origin is one that either matches
    // nothing or — worse — matches something.
    expect(ceremonyOrigin(headers({}))).toBeNull();
    expect(ceremonyOrigin(headers({ host: '' }))).toBeNull();
  });
});

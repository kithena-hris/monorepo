import { describe, expect, it } from 'vitest';

import { isAcceptableOrigin, type OriginPolicy } from './origin.js';

/**
 * Which origins may ask for a passkey.
 *
 * Every case is a way an origin nobody issued could be treated as a tenant. The
 * happy path is two tests; the rest is the reason the file exists.
 */

const policy: OriginPolicy = {
  rpId: 'app.kithena.com',
  authOrigin: 'https://auth.app.kithena.com',
};

describe('isAcceptableOrigin', () => {
  it('accepts the dedicated ceremony origin', () => {
    expect(isAcceptableOrigin('https://auth.app.kithena.com', policy)).toBe(true);
  });

  it('accepts a tenant origin, because one passkey serves every employer', () => {
    expect(isAcceptableOrigin('https://acme.app.kithena.com', policy)).toBe(true);
    expect(isAcceptableOrigin('https://globex.app.kithena.com', policy)).toBe(true);
  });

  it('refuses a suffix that merely looks right', () => {
    // The attack: register `acme.app.kithena.com.evil.com`, point it anywhere,
    // and rely on something that only compared the start of the string.
    expect(isAcceptableOrigin('https://acme.app.kithena.com.evil.com', policy)).toBe(false);
    expect(isAcceptableOrigin('https://evil-app.kithena.com', policy)).toBe(false);
  });

  it('refuses the Reach sites, which are public and unprotected', () => {
    // The reason the RP ID is `app.kithena.com` and not `kithena.com`. CLAUDE.md
    // records both of these as world-readable, and a registrable suffix one
    // level up would have made every credential in the product assertable from
    // a Storybook story.
    expect(isAcceptableOrigin('https://design.kithena.com', policy)).toBe(false);
    expect(isAcceptableOrigin('https://storybook.kithena.com', policy)).toBe(false);
    expect(isAcceptableOrigin('https://kithena.com', policy)).toBe(false);
  });

  it('refuses more than one label in front of the suffix', () => {
    // A wildcard certificate covers `*.app.kithena.com` and nothing deeper.
    expect(isAcceptableOrigin('https://a.b.app.kithena.com', policy)).toBe(false);
  });

  it('refuses the bare suffix and every reserved label', () => {
    expect(isAcceptableOrigin('https://app.kithena.com', policy)).toBe(false);
    // `login` and `admin` are ours; a tenant holding either could serve a login
    // page on an origin the product treats as its own.
    expect(isAcceptableOrigin('https://login.app.kithena.com', policy)).toBe(false);
    expect(isAcceptableOrigin('https://admin.app.kithena.com', policy)).toBe(false);
  });

  it('refuses plain HTTP unless a development flag says otherwise', () => {
    expect(isAcceptableOrigin('http://acme.app.kithena.com', policy)).toBe(false);
    expect(
      isAcceptableOrigin('http://acme.app.localhost', {
        rpId: 'app.localhost',
        authOrigin: 'http://auth.app.localhost',
        allowInsecure: true,
      }),
    ).toBe(true);
  });

  it('refuses anything carrying a path, query or fragment', () => {
    // An origin has none of these. Accepting them means comparing something
    // that is not an origin against a rule written for one.
    expect(isAcceptableOrigin('https://acme.app.kithena.com/evil', policy)).toBe(false);
    expect(isAcceptableOrigin('https://acme.app.kithena.com?x=1', policy)).toBe(false);
    expect(isAcceptableOrigin('https://acme.app.kithena.com#x', policy)).toBe(false);
  });

  it('refuses junk rather than throwing on it', () => {
    // This runs on unauthenticated input. A parse failure has to be a refusal,
    // not a 500 that tells the caller their string reached the parser.
    for (const junk of ['', 'not a url', 'javascript:alert(1)', '//acme.app.kithena.com']) {
      expect(isAcceptableOrigin(junk, policy), junk).toBe(false);
    }
  });

  it('refuses a punycode label that renders as another tenant', () => {
    // `xn--pple-43d` displays as `äpple`. The contract's slug rules refuse it,
    // and this is where that refusal has to hold.
    expect(isAcceptableOrigin('https://xn--pple-43d.app.kithena.com', policy)).toBe(false);
  });
});

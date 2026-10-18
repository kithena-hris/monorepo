import { describe, expect, it } from 'vitest';

import { googleAccount } from './google.js';

const claims = {
  sub: '1098765',
  email: 'Ada@Acme.example',
  email_verified: true,
  hd: 'acme.example',
  nonce: 'n-1',
  given_name: 'Ada',
  family_name: 'Lovelace',
};

describe('googleAccount', () => {
  it('takes a verified Workspace account that came back with our nonce', () => {
    const account = googleAccount(claims, 'n-1');
    expect(account).toEqual({
      ok: true,
      value: {
        sub: '1098765',
        email: 'ada@acme.example',
        name: { given: 'Ada', family: 'Lovelace', preferred: null },
      },
    });
  });

  it('refuses a personal Google account, whatever address it was opened on', () => {
    // No `hd`: nobody's Workspace manages it, so nobody can switch it off when
    // the person leaves, and anyone can open one on any address they can read.
    const { hd: _hd, ...personal } = claims;
    expect(googleAccount(personal, 'n-1').ok).toBe(false);
    expect(googleAccount({ ...claims, hd: '' }, 'n-1').ok).toBe(false);
  });

  it('takes a Gmail address, whose mailbox is the Google account itself', () => {
    const { hd: _hd, ...gmail } = claims;
    for (const email of ['Ada.Lovelace@gmail.com', 'ada@googlemail.com']) {
      const account = googleAccount({ ...gmail, email }, 'n-1');
      expect(account.ok && account.value.email).toBe(email.toLowerCase());
    }
    // Not a lookalike: only the address's own domain counts.
    expect(googleAccount({ ...gmail, email: 'ada@gmail.com.acme.example' }, 'n-1').ok).toBe(false);
    expect(googleAccount({ ...gmail, email: 'ada@notgmail.com' }, 'n-1').ok).toBe(false);
  });

  it('refuses an address Google has not verified', () => {
    expect(googleAccount({ ...claims, email_verified: false }, 'n-1').ok).toBe(false);
    expect(googleAccount({ ...claims, email_verified: 'true' }, 'n-1').ok).toBe(false);
  });

  it('refuses a token minted for another trip', () => {
    expect(googleAccount(claims, 'n-2').ok).toBe(false);
    const { nonce: _nonce, ...none } = claims;
    expect(googleAccount(none, 'n-1').ok).toBe(false);
  });

  it('refuses a token without a subject or an address', () => {
    expect(googleAccount({ ...claims, sub: '' }, 'n-1').ok).toBe(false);
    const { email: _email, ...nameless } = claims;
    expect(googleAccount(nameless, 'n-1').ok).toBe(false);
  });

  it('leaves the name out when Google has none to give', () => {
    const { given_name: _g, family_name: _f, ...bare } = claims;
    const account = googleAccount(bare, 'n-1');
    expect(account.ok && account.value.name).toBeNull();
  });
});

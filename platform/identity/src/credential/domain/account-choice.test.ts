import { describe, expect, it } from 'vitest';

import { chooseAccount, type AccountCandidate } from './account-choice.js';

const acme: AccountCandidate = {
  accountId: 'acct-acme',
  tenantId: 'tenant-acme',
  tenantSlug: 'acme',
  workEmail: 'Ada.Lovelace@Acme.example',
};

const globex: AccountCandidate = {
  accountId: 'acct-globex',
  tenantId: 'tenant-globex',
  tenantSlug: 'globex',
  workEmail: 'ada@globex.example',
};

describe('chooseAccount', () => {
  it('takes the only account a person holds', () => {
    const chosen = chooseAccount([acme], {});
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value.accountId).toBe('acct-acme');
  });

  it('refuses when the passkey is valid but there is no account', () => {
    // The commissioning rule. A perfectly good passkey belonging to somebody
    // who works nowhere we know finds nothing, and that is what having an
    // account means.
    const chosen = chooseAccount([], {});
    expect(chosen.ok).toBe(false);
    if (!chosen.ok) expect(chosen.error.code).toBe('SIGN_IN_FAILED');
  });

  /*
   * The typed address narrows to one company without the URL naming it. This
   * is what lets one browser sign in as different people on different days
   * without anybody having to know a hostname.
   */
  it('narrows to the account whose work address was typed', () => {
    const chosen = chooseAccount([acme, globex], { workEmail: 'ada@globex.example' });
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value.tenantSlug).toBe('globex');
  });

  it('matches the address however it was capitalised or spaced', () => {
    for (const typed of ['ADA.LOVELACE@ACME.EXAMPLE', '  ada.lovelace@acme.example  ']) {
      const chosen = chooseAccount([acme, globex], { workEmail: typed });
      expect(chosen.ok, typed).toBe(true);
      if (chosen.ok) expect(chosen.value.tenantSlug).toBe('acme');
    }
  });

  /*
   * A passkey that is real and an address that is not is the same answer as
   * everything else here. Saying "that passkey works but not with that
   * address" would confirm which addresses exist to anybody holding any
   * passkey at all.
   */
  it('refuses an address the passkey does not hold an account under', () => {
    const chosen = chooseAccount([acme], { workEmail: 'someone.else@acme.example' });
    expect(chosen.ok).toBe(false);
  });

  it('still honours a tenant when the page named one', () => {
    // The branded per-company page keeps working: it names the tenant and no
    // address is typed.
    const chosen = chooseAccount([acme, globex], { tenantId: 'tenant-globex' });
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value.tenantSlug).toBe('globex');
  });

  it('applies both filters when both are given', () => {
    expect(chooseAccount([acme, globex], {
      tenantId: 'tenant-acme',
      workEmail: 'ada@globex.example',
    }).ok).toBe(false);
  });

  /*
   * Two accounts, one address. `account_live_email_key` is unique per tenant,
   * not globally, so a contractor who somehow uses one address at two
   * customers lands here. It is refused rather than guessed at: signing
   * somebody into the wrong employer is worse than asking them to use the
   * company's own sign-in page, which still works and names the tenant.
   */
  it('refuses rather than guessing when one address matches two companies', () => {
    const twin: AccountCandidate = { ...globex, workEmail: acme.workEmail };
    const chosen = chooseAccount([acme, twin], { workEmail: 'ada.lovelace@acme.example' });
    expect(chosen.ok).toBe(false);
  });

  it('gives the same refusal whatever the reason', () => {
    const none = chooseAccount([], {});
    const wrongAddress = chooseAccount([acme], { workEmail: 'nobody@acme.example' });
    const ambiguous = chooseAccount([acme, { ...globex, workEmail: acme.workEmail }], {
      workEmail: acme.workEmail,
    });

    expect(none).toEqual(wrongAddress);
    expect(wrongAddress).toEqual(ambiguous);
  });
});

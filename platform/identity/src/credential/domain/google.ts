import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { checkName, type PersonName } from '../../shared/person-name.js';

/**
 * Who a Google ID token says this is, or a refusal.
 *
 * The signature, issuer, audience and expiry are checked before this sees the
 * claims (`google-oidc.ts`). What is left is what makes a valid token an
 * acceptable one here:
 *
 * - **`hd`, a Workspace organisation.** A personal Google account can be opened
 *   on any address its owner can read mail at, `ada@acme.example` included, and
 *   nobody at Acme can switch it off when Ada leaves. A Workspace account
 *   carries the organisation's domain and is the company's to suspend; nobody
 *   else can hold that domain without its DNS.
 * - **A verified address**, the one compared with the work address on the
 *   first sign-in. After that the link is `sub`, which Google never reassigns.
 * - **Our nonce**, so a token minted for somebody else's trip cannot be replayed
 *   into this one.
 */
export interface GoogleAccount {
  readonly sub: string;
  /** Lower-cased, as the account's unique index compares it. */
  readonly email: string;
  /** For an invited person enrolling with Google, who fills in no form. */
  readonly name: PersonName | null;
}

const Refused = failure('GOOGLE_ACCOUNT_REFUSED', 'This Google account cannot sign in here');

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function googleAccount(
  claims: Readonly<Record<string, unknown>>,
  nonce: string,
): Result<GoogleAccount> {
  const sub = text(claims['sub']);
  const email = text(claims['email']).toLowerCase();
  if (sub === '' || email === '') return err(Refused);
  if (claims['email_verified'] !== true) return err(Refused);
  if (text(claims['hd']) === '') return err(Refused);
  if (nonce === '' || claims['nonce'] !== nonce) return err(Refused);

  const named = checkName({ given: claims['given_name'], family: claims['family_name'] });
  return ok({ sub, email, name: named.ok ? named.value : null });
}

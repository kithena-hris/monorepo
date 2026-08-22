/**
 * Where a request came from.
 *
 * In `shared/` rather than owned by a slice, because more than one genuinely
 * needs it and none of them owns it: a session records it, a sign-in reports
 * it, an audit event carries it, and risk-based step-up will compare it. That
 * is the test for this folder — not "two slices happen to want the same shape",
 * but "the concept means something on its own".
 *
 * Every field is personal data. The contract classifies `ip` and `userAgent` as
 * contact information, which is what puts them in a subject access request and
 * keeps them out of a model prompt. The address is truncated once the forensics
 * window has passed: for anyone working remotely, a full one is a home address.
 */
export interface Device {
  /**
   * Null when it is not known, never a placeholder.
   *
   * This was `string` with `'unknown'` standing in for absence, which is fine
   * against a `text` column and fatal against `inet`: Postgres rejected the
   * literal with `22P02`, and a sign-in that should have refused politely
   * became a 500. A sentinel that is valid for one column and invalid for
   * another is not a value, it is a bug waiting for the second column.
   */
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** The authenticator model, from WebAuthn. Not a device identifier. */
  readonly aaguid: string | null;
}

/**
 * Whether a string is an address the `inet` column will accept.
 *
 * Making `ip` nullable was not enough on its own. The type stopped this
 * service *inventing* a placeholder, and a caller went on sending one — so a
 * sign-in still died with `22P02` in `network_in`, because "not null" and "is
 * an address" are different claims and only the first was being made.
 *
 * Deliberately permissive about the exact shape and strict about the alphabet:
 * Postgres is the real parser, and the job here is only to keep something that
 * cannot possibly be an address away from a column that will throw on it.
 * IPv4, IPv6 and CIDR suffixes all pass; `unknown` does not.
 */
const ADDRESS = /^[0-9a-fA-F:.]+(?:%[0-9a-zA-Z]+)?(?:\/\d{1,3})?$/;

export function asAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (value.length > 45 + 4) return null;
  return ADDRESS.test(value) ? value : null;
}

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

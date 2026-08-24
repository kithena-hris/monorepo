import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * The address a message is sent to.
 *
 * A branded string rather than a `string`, so that "this was checked" is
 * something the type says rather than something a comment claims. The same
 * argument `Clock` makes in `@kithena/domain-kit` about parsing rather than
 * asserting.
 */
export type EmailAddress = string & { readonly __brand: 'EmailAddress' };

export const AddressRejected = failure(
  'ADDRESS_UNUSABLE',
  'That is not an address a message can be sent to',
);

/**
 * The longest address anyone has. RFC 5321 caps the path at 256 octets
 * including the angle brackets, which leaves 254 for the address itself.
 */
const MAX_LENGTH = 254;

/**
 * Deliberately not a full RFC 5322 grammar.
 *
 * The real grammar admits quoted strings, comments and nested parentheses, and
 * a regex for it is famously several kilobytes long and still wrong. Nothing
 * here needs it: this checks that an address has one `@`, something on each
 * side, a dot in the domain and no whitespace — the properties that separate a
 * usable address from a typo — and leaves the rest to the provider, which knows
 * whether the mailbox exists and this cannot.
 *
 * The value of a shape check here is not correctness of the grammar. It is that
 * an unusable address is refused at the boundary of the system that would
 * otherwise have spent a send on it, and that bounces are what destroy a
 * sending domain's reputation.
 */
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Normalise and check, or refuse.
 *
 * Lower-cased because the same mailbox reached twice under two spellings is two
 * suppression-list entries and two idempotency keys, and because every address
 * in the system arrives from a human typing it.
 *
 * Line breaks are refused ahead of the shape check even though `\s` would catch
 * them, because the reason is different from the reason for the rest. A `\r` or
 * `\n` in an address is a header injection attempt — it is how a value becomes
 * a `Bcc:` — and a value refused for a specific reason should be refused where
 * that reason is written down.
 */
export function toAddress(raw: string): Result<EmailAddress> {
  const trimmed = raw.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return err(AddressRejected);
  if (/[\r\n]/.test(trimmed)) return err(AddressRejected);

  const normalised = trimmed.toLowerCase();
  if (!SHAPE.test(normalised)) return err(AddressRejected);

  return ok(normalised as EmailAddress);
}

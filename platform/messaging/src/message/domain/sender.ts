import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { toAddress, type EmailAddress } from './address.js';

/**
 * Who a message is from.
 *
 * A parsed value rather than the raw string, and the parsing is the point. The
 * sender is the one setting that changes when a company moves from a shared
 * mailbox to a dedicated sending address, and the failure mode of getting it
 * wrong is unusually bad: the provider does not refuse a malformed `from` until
 * something is actually sent, so a typo deploys clean, sits there, and surfaces
 * as the first new hire never receiving their invitation.
 *
 * Checking it at boot turns that into a service that will not start, which is a
 * deployment somebody notices in the minute they made the change rather than on
 * the morning somebody else starts a job.
 */
export interface Sender {
  /** The name a mail client shows in the inbox list. Null for a bare address. */
  readonly displayName: string | null;
  readonly address: EmailAddress;
  /** `Name <a@b.c>`, normalised, ready for the provider. */
  readonly formatted: string;
}

export const SenderUnusable = failure(
  'SENDER_UNUSABLE',
  'RESEND_FROM must be an address, optionally as `Name <address@domain>`',
);

/** `Name <address@domain>`, with the name optional and unquoted. */
const ANGLED = /^\s*(.*?)\s*<([^<>]+)>\s*$/;

/**
 * Accepts either form, because both are things a person writes.
 *
 * `Kithena <info@kithena.com>` is what you want in an inbox list, and
 * `info@kithena.com` is what somebody types when they are in a hurry. The
 * second is not an error; it just has no display name, and the provider will
 * show the address instead.
 *
 * The display name is deliberately not quoted or escaped here beyond refusing
 * the characters that would break the header. A name containing a comma or a
 * quote is a real name, and mangling it silently is worse than refusing it —
 * so those are refused and the operator picks a different one.
 */
export function parseSender(raw: string): Result<Sender> {
  const trimmed = raw.trim();
  if (trimmed === '') return err(SenderUnusable);

  const angled = ANGLED.exec(trimmed);
  const displayName = angled === null ? '' : (angled[1] ?? '');
  const address = toAddress(angled === null ? trimmed : (angled[2] ?? ''));
  if (!address.ok) return err(SenderUnusable);

  if (displayName === '') {
    return ok({ displayName: null, address: address.value, formatted: address.value });
  }

  /*
   * The characters that end a display name early.
   *
   * `<` and `>` would close the address, `"` would close a quoted string, and a
   * comma separates addresses — any of them turns one sender into two, or into
   * a header that is not the one intended. A line break is the header-injection
   * case and is refused for the same reason it is in `toAddress`.
   *
   * Refused rather than stripped, because a company called "Smith, Jones" has a
   * comma in its name on purpose and quietly deleting it is a worse answer than
   * asking for a different string.
   */
  if (/["<>,\r\n]/.test(displayName)) return err(SenderUnusable);

  return ok({
    displayName,
    address: address.value,
    formatted: `${displayName} <${address.value}>`,
  });
}

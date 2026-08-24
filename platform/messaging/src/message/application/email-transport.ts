import type { Result } from '@kithena/domain-kit';

import type { EmailAddress } from '../domain/address.js';

/**
 * The port every provider is adapted to.
 *
 * Deliberately smaller than any provider's API. What is here is what a
 * transactional message needs and nothing else: one recipient, a subject, both
 * bodies, and the key that makes a retry a retry. No templates, no contacts, no
 * scheduling, no broadcast — those exist in Resend and adopting them would put
 * the copy, the audience and the send policy inside somebody else's dashboard,
 * where the repository cannot review a change to any of them.
 *
 * One recipient rather than a list, because these messages are addressed to a
 * person. A `to` array is how the person in position two learns who else was
 * invited.
 */
export interface OutgoingEmail {
  readonly to: EmailAddress;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /**
   * What makes a second attempt the same send.
   *
   * Providers accept and charge for whatever they are given, so a retry after a
   * timeout — where the request succeeded and the response was lost — sends the
   * message twice without one. Resend keys these for 24 hours and refuses the
   * same key with a different payload, which is the behaviour worth designing
   * against: the key has to change when the message changes and not otherwise.
   */
  readonly idempotencyKey: string;
}

/**
 * What came back. `id` is the provider's, and it is the only thread between a
 * line in our logs and a row in someone else's dashboard when a message did not
 * arrive. Null for a transport that has no such concept — the local one that
 * writes to the log rather than sending.
 */
export interface SentMessage {
  readonly id: string | null;
}

export interface EmailTransport {
  /** Named, so a log line can say which one refused without naming a vendor twice. */
  readonly name: string;
  send(email: OutgoingEmail): Promise<Result<SentMessage>>;
}

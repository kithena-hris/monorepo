import type { EmailAddress } from '../domain/address.js';

/**
 * What was sent, to whom, and what became of it.
 *
 * ### What this deliberately cannot record
 *
 * There is no body, no subject and no link on any of these types, and that is
 * the design rather than an oversight. The enrolment link is the one secret
 * passing through this service; `platform.enrolment_token` stores only its
 * SHA-256 so that a backup, a replica or a support query yields nothing usable,
 * and a rendered message in a table would undo that in one column.
 *
 * What is recorded is the outcome, which is what the questions are actually
 * about: HR asks "did the invitation go out", and an operator asks "why not".
 *
 * ### Why it is a port
 *
 * Because the answer to "where does this go" is not always Postgres. A
 * deployment with no database — the one a developer runs, where the transport
 * writes to the log — gets an implementation that does nothing, and the use
 * case cannot tell.
 */
export type MessageKind = 'account_invitation';

/**
 * Where a message got to.
 *
 * `accepted` is what we know at send time and nothing more: a provider queueing
 * a message is not a mailbox receiving one. The rest arrive later, by webhook,
 * which is the only reason a provider id is worth keeping.
 */
export type DeliveryStatus =
  'accepted' | 'delivered' | 'bounced' | 'complained' | 'suppressed' | 'failed';

export interface DeliveryRecord {
  readonly tenantId: string;
  readonly kind: MessageKind;
  readonly to: EmailAddress;
  readonly provider: string;
  /** Null for a transport with no such concept, and for a send that failed. */
  readonly providerMessageId: string | null;
  readonly status: DeliveryStatus;
  /** A closed set from the send path or the provider's own event. Never a
   *  message we pass through — a provider's error string quotes the address. */
  readonly reason: string | null;
}

export interface DeliveryLog {
  /** Records an attempt. Returns the id of the row, for a log line to carry. */
  record(delivery: DeliveryRecord): Promise<string | null>;

  /**
   * Moves a recorded message to what the provider now says it is.
   *
   * Returns false when no such message is known, which is the ordinary case
   * rather than an error: a provider replays events, and one naming a message
   * from before this table existed is a fact about our history, not a failure.
   */
  settle(input: {
    provider: string;
    providerMessageId: string;
    status: DeliveryStatus;
    reason: string | null;
  }): Promise<boolean>;
}

/**
 * The one for a deployment with no database.
 *
 * Not a silent no-op: it reports that nothing was recorded, so a caller logging
 * the row id logs `null` and the difference is visible. A stub that returned a
 * plausible id would make a deployment with no delivery log look exactly like
 * one that has it.
 */
export const noDeliveryLog: DeliveryLog = {
  record: () => Promise.resolve(null),
  settle: () => Promise.resolve(false),
};

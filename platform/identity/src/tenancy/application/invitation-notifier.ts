/**
 * Telling somebody they have been invited.
 *
 * A port, and a deliberately forgiving one: `send` reports what happened and
 * never fails the operation that called it. The account exists and the link is
 * in the response either way, so a messaging service that is down should not be
 * able to fail an invitation — it should be able to make an operator hand the
 * link over in person, which is the channel `docs/authentication.md` prefers
 * anyway.
 *
 * The implementation lives in `infrastructure/` and speaks HTTP to
 * `platform/messaging`. It is not an import: identity holds the enrolment token
 * for the one moment it exists in plaintext, and messaging holds a third
 * party's API key. Neither should be inside the other's process.
 */
export interface Invitation {
  readonly tenantId: string;
  /** The company's display name. What the message is about. */
  readonly companyName: string;
  readonly email: string;
  /**
   * The single-use enrolment link, complete.
   *
   * Built here rather than there, because the token exists in plaintext exactly
   * once — the row holds only its hash — and the shape of an enrolment link is
   * identity's business. Messaging checks that it points at the auth origin and
   * otherwise treats it as opaque.
   */
  readonly enrolUrl: string;
  readonly expiresAt: string;
  /**
   * The company's mark, or null when they have asked not to be shown.
   *
   * Resolved through `brandingFor` before it gets here, so the messaging
   * service never has to know the flag exists. A template that had to remember
   * to check one is a template that leaks the first time somebody adds a
   * header — the same argument the login page makes.
   */
  readonly logoUrl: string | null;
}

export interface Delivery {
  readonly delivered: boolean;
  /** The provider's id, when there is one. The thread between our log and theirs. */
  readonly messageId: string | null;
  /** Why not, for the operator. A closed set from the messaging service. */
  readonly reason: string | null;
}

export const notDelivered = (reason: string): Delivery => ({
  delivered: false,
  messageId: null,
  reason,
});

export interface InvitationNotifier {
  send(invitation: Invitation): Promise<Delivery>;
}

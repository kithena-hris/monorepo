import { createHash } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { toAddress } from '../domain/address.js';
import { linkIsTrusted, renderInvitation } from '../domain/invitation.js';
import type { EmailTransport } from './email-transport.js';
import type { DeliveryLog } from './delivery-log.js';

/**
 * Send one person their invitation.
 *
 * The whole use case is four refusals and a send, and the refusals are the
 * interesting part: an address that will bounce, a link pointing somewhere that
 * is not ours, copy that cannot be rendered, and a provider that said no. Each
 * is a different thing to do about it, so each is a distinct reason in the log
 * and a single opaque code to the caller.
 */

export interface SendInvitationRequest {
  /** Whose invitation this is. For the log, never for the recipient. */
  readonly tenantId: string;
  readonly companyName: string;
  readonly email: string;
  /** The single-use enrolment link, built by whoever minted the token. */
  readonly enrolUrl: string;
  readonly expiresAt: string;
  /**
   * The company's mark, or nothing.
   *
   * Whether a company may be shown is not decided here. `brandingFor` in the
   * identity service answers it once, for every surface, so a company that has
   * asked not to be named arrives with this already null — a template that had
   * to remember to check a flag is a template that leaks.
   */
  readonly logoUrl?: string | null | undefined;
}

export type SendRefusal = 'address' | 'untrusted_link' | 'unrenderable' | 'provider';

const Refused = (reason: SendRefusal): ReturnType<typeof failure> =>
  failure('INVITATION_NOT_SENT', 'The invitation could not be sent', [reason]);

export interface SendInvitationDeps {
  readonly transport: EmailTransport;
  /**
   * Where the outcome is recorded. Never the message.
   *
   * Every path that reaches the provider is logged, including the ones that
   * come back refused — a bounce is the interesting case and it is the one a
   * "record only what succeeded" log would lose. The refusals that never reach
   * the provider are not logged here: nothing was sent, so there is no delivery
   * to have a record of, and they are already a distinct reason in the log.
   */
  readonly deliveries: DeliveryLog;
  /**
   * The only origin a link in one of these messages may point at.
   *
   * Configuration rather than a constant, because it is the auth origin and
   * that differs per environment. It is checked here rather than trusted from
   * the caller for the reason `linkIsTrusted` gives.
   */
  readonly trustedLinkOrigin: string;
  readonly onRefusal?: (reason: SendRefusal, detail: Record<string, string>) => void;
}

export type SendInvitation = (
  request: SendInvitationRequest,
) => Promise<Result<{ messageId: string | null }>>;

export function sendInvitation(deps: SendInvitationDeps): SendInvitation {
  const refuse = (reason: SendRefusal, detail: Record<string, string> = {}): Result<never> => {
    deps.onRefusal?.(reason, detail);
    return err(Refused(reason));
  };

  return async (request) => {
    const recipient = toAddress(request.email);
    if (!recipient.ok) return refuse('address');

    // Before rendering, so a link we would never send is not spent on building
    // a message body first.
    if (!linkIsTrusted(request.enrolUrl, deps.trustedLinkOrigin)) {
      return refuse('untrusted_link');
    }

    const message = renderInvitation({
      companyName: request.companyName,
      recipient: recipient.value,
      enrolUrl: request.enrolUrl,
      expiresAt: request.expiresAt,
      logoUrl: request.logoUrl ?? null,
    });
    if (!message.ok) return refuse('unrenderable');

    const sent = await deps.transport.send({
      to: recipient.value,
      subject: message.value.subject,
      html: message.value.html,
      text: message.value.text,
      idempotencyKey: idempotencyKeyFor(request.enrolUrl),
    });

    /*
     * Recorded before the result is returned, and recorded either way.
     *
     * A log that only holds successes cannot answer the question it exists for.
     * "Did Grace's invitation go out" has three answers — yes, no, and the
     * provider refused the address — and the last two are the ones somebody
     * acts on.
     *
     * `accepted`, not `delivered`: a provider queueing a message is not a
     * mailbox receiving one, and the difference arrives later by webhook.
     */
    await deps.deliveries.record({
      tenantId: request.tenantId,
      kind: 'account_invitation',
      to: recipient.value,
      provider: deps.transport.name,
      providerMessageId: sent.ok ? sent.value.id : null,
      status: sent.ok ? 'accepted' : 'failed',
      reason: sent.ok ? null : (sent.error.path?.[0] ?? sent.error.code),
    });

    if (!sent.ok) return refuse('provider', { cause: sent.error.code });
    return ok({ messageId: sent.value.id });
  };
}

/**
 * The key that decides whether a second attempt is a retry or a new message.
 *
 * Derived from the link, which is exactly the thing that changes when the
 * invitation does. Re-issuing invalidates the previous token, so a reissue
 * produces a different URL and therefore a different key and therefore a second
 * send — which is right, because the link in the first message is now dead. A
 * genuine retry of the same request produces the same URL and collapses into
 * the original send, which is also right.
 *
 * Keyed on the account instead, the two cases would be indistinguishable: a
 * reissue within the provider's 24-hour window would either be swallowed
 * silently or rejected as a conflict, and in both cases the person who needs a
 * working link would never receive one.
 *
 * Hashed, and truncated, because the URL carries the enrolment token. The token
 * is stored as a hash precisely so it cannot be read back out of anything, and
 * putting it verbatim into a header that a provider logs and shows in a
 * dashboard would undo that in one line. 160 bits of the digest is far more
 * than enough for a key whose only job is to be distinct.
 */
function idempotencyKeyFor(enrolUrl: string): string {
  const digest = createHash('sha256').update(enrolUrl).digest('base64url').slice(0, 27);
  return `account-invitation/${digest}`;
}

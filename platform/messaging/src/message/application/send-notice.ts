import { createHash } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { toAddress } from '../domain/address.js';
import { linkIsTrusted } from '../domain/invitation.js';
import { renderNotice, type Notice } from '../domain/notice.js';
import type { DeliveryLog } from './delivery-log.js';
import type { EmailTransport } from './email-transport.js';
import type { SendRefusal } from './send-invitation.js';

/**
 * Send one person one notice.
 *
 * The invitation's use case with the invitation taken out: the same four
 * refusals, the same send, the same outcome-only record. The link is checked
 * against the app's origin rather than the auth origin, because a notice
 * points into the product.
 */
export interface SendNoticeRequest {
  readonly tenantId: string;
  readonly email: string;
  /** Where the button goes. Built by the caller, checked here. */
  readonly url: string;
  readonly notice: Notice;
  /**
   * What makes a retry the same message, chosen by the caller — for a
   * reminder, the person and the instant it was claimed. Hashed before it
   * reaches the provider, because it names a record.
   */
  readonly dedupeKey: string;
}

export type SendNotice = (request: SendNoticeRequest) => Promise<Result<{ messageId: string | null }>>;

export interface SendNoticeDeps {
  readonly transport: EmailTransport;
  readonly deliveries: DeliveryLog;
  readonly trustedLinkOrigin: string;
  readonly onRefusal?: (reason: SendRefusal, detail: Record<string, string>) => void;
}

export function sendNotice(deps: SendNoticeDeps): SendNotice {
  const refuse = (reason: SendRefusal, detail: Record<string, string> = {}): Result<never> => {
    deps.onRefusal?.(reason, detail);
    return err(failure('NOTICE_NOT_SENT', 'The notice could not be sent', [reason]));
  };

  return async (request) => {
    const recipient = toAddress(request.email);
    if (!recipient.ok) return refuse('address');
    if (!linkIsTrusted(request.url, deps.trustedLinkOrigin)) return refuse('untrusted_link');

    const message = renderNotice(request.notice, request.url);
    if (!message.ok) return refuse('unrenderable');

    const kind = request.notice.kind;
    const digest = createHash('sha256')
      .update(`${request.tenantId}/${request.dedupeKey}`)
      .digest('base64url')
      .slice(0, 27);
    const sent = await deps.transport.send({
      to: recipient.value,
      subject: message.value.subject,
      html: message.value.html,
      text: message.value.text,
      idempotencyKey: `${kind}/${digest}`,
    });

    // The outcome, never the message: no subject, no body, no link.
    await deps.deliveries.record({
      tenantId: request.tenantId,
      kind,
      to: recipient.value,
      provider: deps.transport.name,
      providerMessageId: sent.ok ? sent.value.id : null,
      status: sent.ok ? 'accepted' : 'failed',
      reason: sent.ok ? null : (sent.error.path?.[0] ?? sent.error.code),
    });

    if (!sent.ok) return refuse('provider', { cause: sent.error.code, kind });
    return ok({ messageId: sent.value.id });
  };
}

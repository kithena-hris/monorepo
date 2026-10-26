import { createHash } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { toAddress } from '../domain/address.js';
import {
  CORRESPONDENCE_KIND,
  renderCorrespondence,
  type CorrespondenceParts,
} from '../domain/correspondence.js';
import { inEnglish, type CompanyBrand, type CompanyLanguage } from './company-language.js';
import type { DeliveryLog } from './delivery-log.js';
import type { EmailTransport } from './email-transport.js';
import type { SendRefusal } from './send-invitation.js';

/**
 * Send one piece of correspondence (Recruiting PRD §12.7): the notice's send
 * with the module's own words, and the same outcome-only record.
 */
export interface SendCorrespondenceRequest {
  readonly tenantId: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** The company's reply address, so the candidate's answer lands on the thread. */
  readonly replyTo: string | null;
  readonly companyName: string;
  readonly dedupeKey: string;
  /**
   * A calendar invitation (`.ics`) or a PDF the module drew: never a file a
   * person uploaded, so nothing here needs scanning. The record of the send
   * holds neither its name nor its bytes.
   */
  readonly attachments?:
    readonly { readonly filename: string; readonly base64: string }[] | undefined;
  /** Structure beside the words, drawn by this service (`correspondence.ts`), never markup. */
  readonly parts?: CorrespondenceParts | undefined;
  /** A member of the company rather than a candidate: their footer, and where they change what reaches them. */
  readonly member?: { readonly manageHref: string | null } | undefined;
}

export type SendCorrespondence = (
  request: SendCorrespondenceRequest,
) => Promise<Result<{ messageId: string | null }>>;

export function sendCorrespondence(deps: {
  readonly transport: EmailTransport;
  readonly deliveries: DeliveryLog;
  readonly onRefusal?: (reason: SendRefusal, detail: Record<string, string>) => void;
  /** The company's language, for the frame around the module's words. US English when absent. */
  readonly language?: CompanyLanguage;
  /** The company's name, mark and colour, for an email that did not say. */
  readonly brand?: CompanyBrand;
}): SendCorrespondence {
  const refuse = (reason: SendRefusal, detail: Record<string, string> = {}): Result<never> => {
    deps.onRefusal?.(reason, detail);
    return err(failure('CORRESPONDENCE_NOT_SENT', 'The email could not be sent', [reason]));
  };
  return async (request) => {
    const recipient = toAddress(request.to);
    if (!recipient.ok) return refuse('address');
    const replyTo = request.replyTo === null ? null : toAddress(request.replyTo);
    if (replyTo !== null && !replyTo.ok) return refuse('address');
    // Every email in the company's name, mark and colours: what the module
    // did not say, the company's own settings do; Kithena is never the sender.
    const brand = (await deps.brand?.(request.tenantId).catch(() => null)) ?? null;
    const parts = request.parts ?? {};
    const message = renderCorrespondence(
      request.subject,
      request.text,
      brand !== null && (request.companyName === '' || request.companyName === 'Kithena')
        ? brand.companyName
        : request.companyName,
      {
        ...parts,
        logoUrl: parts.logoUrl ?? brand?.logoUrl ?? null,
        themeId: parts.themeId ?? brand?.themeId ?? null,
      },
      await (deps.language ?? inEnglish)(request.tenantId),
      request.member ?? null,
    );
    if (!message.ok) return refuse('unrenderable');
    const digest = createHash('sha256')
      .update(`${request.tenantId}/${request.dedupeKey}`)
      .digest('base64url')
      .slice(0, 27);
    const sent = await deps.transport.send({
      to: recipient.value,
      subject: message.value.subject,
      html: message.value.html,
      text: message.value.text,
      idempotencyKey: `${CORRESPONDENCE_KIND}/${digest}`,
      ...(replyTo === null ? {} : { replyTo: replyTo.value }),
      ...(request.attachments === undefined || request.attachments.length === 0
        ? {}
        : { attachments: request.attachments }),
    });
    // The outcome, never the message.
    await deps.deliveries.record({
      tenantId: request.tenantId,
      kind: CORRESPONDENCE_KIND,
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

import { createTransport } from 'nodemailer';

import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { EmailTransport, OutgoingEmail, SentMessage } from '../application/email-transport.js';

/**
 * SMTP, for a mailbox on this machine.
 *
 * `docker-compose.yml` has run Mailpit on 1025 since the first commit and
 * nothing ever sent to it. Without a transport that can, the only way to read a
 * message locally was the log transport's plain-text dump — which is enough to
 * copy a link out of and no use at all for the half of this service that is
 * markup. A co-branded invitation that renders wrongly in a real client is
 * exactly the bug the log cannot show.
 *
 * ### Why a dependency
 *
 * `nodemailer`, MIT-0, and the alternative was writing SMTP and MIME by hand.
 * The protocol conversation is short; assembling a multipart body with a
 * quoted-printable HTML part, correct boundaries and header folding is not, and
 * getting it subtly wrong produces a message that looks fine in Mailpit and
 * broken in Outlook — which defeats the point of having it. Nothing else in the
 * stack speaks SMTP.
 *
 * ### Why it is not a production path
 *
 * It is selected by `SMTP_URL` and `composition.ts` refuses it when the log
 * transport is refused, so the same rule that keeps a developer's transport out
 * of production keeps this one out too. Resend remains the deployed provider,
 * with the deliverability, the bounce webhooks and the reputation that come
 * with it — a self-hosted SMTP relay has none of those and this is not an
 * attempt at one.
 */
export interface SmtpTransportConfig {
  /** `smtp://localhost:1025` for Mailpit. Credentials belong in the URL if a relay wants them. */
  readonly url: string;
  /** `Name <address@example.com>`, already parsed and formatted by the caller. */
  readonly from: string;
  readonly replyTo?: string | undefined;
  /**
   * Says a message went out, and where to read it.
   *
   * The log transport printed the whole message, so a developer watching the
   * terminal saw every link. This one prints nothing by design — the message is
   * in a mailbox — and the first thing that happened after switching was
   * somebody reasonably concluding that email had stopped working. A line per
   * send costs nothing and is the difference between "no emails are sent" and
   * "open the inbox".
   */
  readonly note?: (line: string) => void;
  /** Where the mailbox can be read, for that line. Mailpit's UI, not its SMTP port. */
  readonly inboxUrl?: string | undefined;
}

export function smtpTransport(config: SmtpTransportConfig): EmailTransport {
  /*
   * No connection pool, and that is the point.
   *
   * A pool keeps sockets open, which keeps the event loop alive, which stops
   * the process exiting — so `tsx watch` could not restart messaging on a save
   * and sat there force-killing it while an older build kept serving. A pooled
   * connection is worth having under load; this transport exists for one
   * developer's mailbox and sends one message at a time.
   */
  const mailer = createTransport({ url: config.url });

  return {
    name: 'smtp',

    async send(email: OutgoingEmail): Promise<Result<SentMessage>> {
      try {
        const sent = await mailer.sendMail({
          from: config.from,
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: email.html,
          /*
           * The idempotency key as a header, because SMTP has no concept of
           * one. Mailpit shows it, which is enough to see that a retry carried
           * the same key — and a relay that does deduplicate has something to
           * key on rather than nothing.
           */
          headers: { 'X-Idempotency-Key': email.idempotencyKey },
          ...(config.replyTo === undefined ? {} : { replyTo: config.replyTo }),
        });

        config.note?.(
          `email to ${email.to}: ${email.subject}${
            config.inboxUrl === undefined ? '' : ` — read it at ${config.inboxUrl}`
          }`,
        );

        // The provider's id, which for Mailpit is the Message-ID it assigned.
        // The same thread between a log line and a message somebody is looking
        // at that `SentMessage.id` is for everywhere else.
        return ok({ id: typeof sent.messageId === 'string' ? sent.messageId : null });
      } catch (cause) {
        return err(
          failure(
            'SMTP_REFUSED',
            `SMTP at ${config.url} refused the message: ${cause instanceof Error ? cause.message : 'unknown'}`,
            [],
          ),
        );
      }
    },
  };
}

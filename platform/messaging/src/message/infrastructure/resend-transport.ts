import { Resend } from 'resend';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { EmailTransport, OutgoingEmail, SentMessage } from '../application/email-transport.js';

/**
 * Resend, behind the port.
 *
 * The provider's SDK rather than a `fetch` against its REST API, which would
 * also have worked and is what this repository's usual instinct would be. Two
 * things earn the dependency. It is the only client that speaks the
 * `Idempotency-Key` contract the send path depends on without us restating it,
 * and it ships `webhooks.verify` — bounce and complaint handling is the next
 * piece of this service, an invitation to a mistyped work address is a bounce
 * HR needs to see, and Svix signature verification is not code to hand-roll.
 *
 * Everything vendor-shaped stops here. `EmailTransport` names one recipient, a
 * subject and two bodies, and swapping providers is this file.
 */

export interface ResendConfig {
  readonly apiKey: string;
  /**
   * `Name <address@domain>`. The domain must be one verified in Resend, and it
   * must match exactly — a key verified for `send.kithena.com` and a `from` of
   * `invitations@kithena.com` is a 403 at send time, not at deploy time.
   */
  readonly from: string;
  /**
   * Where a reply goes. Worth setting: people answer these, and a reply that
   * bounces off a no-reply mailbox is a new hire who could not ask a question.
   */
  readonly replyTo?: string | undefined;
}

const ProviderRefused = (detail: string): ReturnType<typeof failure> =>
  failure('PROVIDER_REFUSED', 'The email provider did not accept the message', [detail]);

export function resendTransport(config: ResendConfig): EmailTransport {
  const resend = new Resend(config.apiKey);

  return {
    name: 'resend',

    async send(email: OutgoingEmail): Promise<Result<SentMessage>> {
      /*
       * The SDK does not throw on an API error — it returns `{ data, error }`,
       * and a `try`/`catch` around it therefore catches nothing and reports
       * every 4xx as a success. The `try` here is for the layer beneath: DNS,
       * TLS and a socket that dies mid-request still throw, and an unhandled
       * rejection inside a send would take down a request that has already
       * committed a database transaction.
       */
      let response: Awaited<ReturnType<typeof resend.emails.send>>;
      try {
        response = await resend.emails.send(
          {
            from: config.from,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            // Both parts. See `renderInvitation` for why the text one is not
            // optional.
            text: email.text,
            ...(config.replyTo === undefined ? {} : { replyTo: config.replyTo }),
          },
          { idempotencyKey: email.idempotencyKey },
        );
      } catch (cause) {
        return err(ProviderRefused(cause instanceof Error ? cause.name : 'unreachable'));
      }

      if (response.error) {
        // The name, not the message. A provider's message quotes the address it
        // refused, and this failure travels to a log and back to the
        // back-office; the name says what to do about it and names nobody.
        return err(ProviderRefused(response.error.name));
      }

      // `data` is non-null once `error` has been ruled out; the SDK's return
      // type is a union of the two.
      return ok({ id: response.data.id });
    },
  };
}

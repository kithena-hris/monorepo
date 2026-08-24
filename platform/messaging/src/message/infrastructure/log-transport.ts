import { ok, type Result } from '@kithena/domain-kit';

import type { EmailTransport, OutgoingEmail, SentMessage } from '../application/email-transport.js';

/**
 * The transport a developer gets when no API key is configured.
 *
 * The same shape as the identity service's throwaway signing key: a missing
 * setting produces something that works locally and says so, rather than a boot
 * failure on a machine that was never going to send an email. It is also the
 * only way to walk the invitation flow without spending a real send on a real
 * mailbox, which is worth more than it sounds — the enrolment link is
 * single-use, so every walk through the flow needs a fresh one.
 *
 * It writes the link deliberately. That is the one thing this service handles
 * which must never reach a log in production, and it is exactly what a
 * developer needs on their own machine. The two are reconciled by which
 * transport gets composed: `composition.ts` refuses to select this one when the
 * environment is production, so the rule is enforced at the seam rather than
 * remembered here.
 */
export function logTransport(write: (line: string) => void): EmailTransport {
  return {
    name: 'log',

    send(email: OutgoingEmail): Promise<Result<SentMessage>> {
      write(
        [
          '',
          '─── invitation (not sent: no RESEND_API_KEY) ───',
          `  to:      ${email.to}`,
          `  subject: ${email.subject}`,
          '',
          email.text,
          '────────────────────────────────────────────────',
          '',
        ].join('\n'),
      );

      // Null rather than a made-up id. Nothing can look this up in a
      // dashboard, and an identifier that resolves to nothing is worse than
      // admitting there is none.
      return Promise.resolve(ok({ id: null }));
    },
  };
}

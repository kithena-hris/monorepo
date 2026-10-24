import { logger } from '@kithena/telemetry';

import type { Mailer } from '../application/ports.js';
import { mailWords } from './mail-words.js';

/**
 * Performance's email through messaging (`platform/messaging`):
 * `POST /api/internal/messaging/correspondence` under the Performance–messaging
 * pair's own secret: reminders and notices in the words Performance wrote,
 * and a session's calendar invitation beside them. Messaging sends it and
 * records the outcome, never the body.
 */
export function httpMailer(config: { readonly baseUrl: string; readonly token: string }): Mailer {
  const endpoint = new URL('/api/internal/messaging/correspondence', config.baseUrl).toString();
  return {
    words: mailWords(config),
    async send(input) {
      const said = { module: 'performance', dedupeKey: input.dedupeKey };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify({ ...input, replyTo: null }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e: unknown) => {
        logger.error({ ...said, err: e }, 'messaging could not be reached; the email was not sent');
        throw e;
      });
      if (!response.ok) {
        logger.error({ ...said, status: response.status }, 'messaging refused the email');
        throw new Error(`messaging refused the email: ${String(response.status)}`);
      }
    },
  };
}

/** The mailer when `MESSAGING_URL` and `MESSAGING_PERFORMANCE_TOKEN` are set; else none, said once. */
export function mailerFrom(env: NodeJS.ProcessEnv): Mailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_PERFORMANCE_TOKEN'];
  if (!baseUrl || !token) {
    logger.info(
      { module: 'performance' },
      'MESSAGING_URL or MESSAGING_PERFORMANCE_TOKEN unset; Performance sends no email',
    );
    return undefined;
  }
  return httpMailer({ baseUrl, token });
}

import { logger } from '@kithena/telemetry';

import type { Mailer } from '../application/ports.js';

/**
 * Documents' notices through messaging (`platform/messaging`), Time Off's
 * adapter: `POST /api/internal/messaging/notice` under the Documents–messaging
 * pair's own secret. Messaging writes the words and checks the link is on
 * the company's own host.
 */
export function httpMailer(config: { readonly baseUrl: string; readonly token: string }): Mailer {
  const endpoint = new URL('/api/internal/messaging/notice', config.baseUrl).toString();
  return {
    async notice(input) {
      // Never the address, the link or a code: which notice, and why it did not go.
      const said = { module: 'documents', kind: input.notice.kind, dedupeKey: input.dedupeKey };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify(input),
        // A signed copy is a few megabytes on the way: longer than a notice alone.
        signal: AbortSignal.timeout(input.attachment === undefined ? 5000 : 30_000),
      }).catch((e: unknown) => {
        logger.error(
          { ...said, err: e },
          'messaging could not be reached; the notice was not sent',
        );
        throw e;
      });
      if (!response.ok) {
        const answer = await response.text().catch(() => '');
        logger.error(
          { ...said, status: response.status, answer: answer.slice(0, 300) },
          'messaging refused the notice',
        );
        throw new Error(`messaging refused the notice: ${String(response.status)}`);
      }
    },
  };
}

/** The mailer when `MESSAGING_URL` and `MESSAGING_DOCUMENTS_TOKEN` are set; else none, said once. */
export function mailerFrom(env: NodeJS.ProcessEnv): Mailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_DOCUMENTS_TOKEN'];
  if (!baseUrl || !token) {
    logger.info(
      { module: 'documents' },
      'MESSAGING_URL or MESSAGING_DOCUMENTS_TOKEN unset; outside signers get no email',
    );
    return undefined;
  }
  return httpMailer({ baseUrl, token });
}

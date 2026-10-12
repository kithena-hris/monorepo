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
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`messaging refused the notice: ${String(response.status)}`);
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

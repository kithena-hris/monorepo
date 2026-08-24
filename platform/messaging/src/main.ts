import { createServer } from 'node:http';
import { logger, startTelemetry } from '@kithena/telemetry';

import { compose } from './composition.js';

/**
 * The messaging service.
 *
 * Port 4101. Modules take 40xx and platform services take 41xx, with identity
 * already on 4100.
 *
 * ### Why this is not part of the identity service
 *
 * It is a different job with a different blast radius. Identity holds the
 * signing key, the credential table and a database role that row-level security
 * depends on; messaging holds a third party's API key and talks to the public
 * internet on every request. Putting an outbound HTTP client with a vendor SDK
 * inside the process that mints session tokens buys nothing and widens the
 * thing an attacker gets for compromising it.
 *
 * It is also not identity's concern for long. Time Off will want to tell a
 * manager a request is waiting, and a module may not import a platform service
 * — so the thing that sends mail has to be reachable over the wire from the
 * start, or it gets built twice.
 *
 * ### What it holds, and what it refuses to
 *
 * One table, `messaging.delivery`, and it records outcomes only: who a message
 * was for, which kind it was, which provider took it, what the provider called
 * it, and how it ended.
 *
 * There is no body column and there is not going to be one. The enrolment link
 * is the one secret passing through here, and `platform.enrolment_token` stores
 * only its SHA-256 precisely so that a backup, a replica or a support query
 * yields nothing usable — a rendered message in a table would undo that in one
 * column, and it is the easy thing to add.
 *
 * The connection is optional. With no `MESSAGING_DATABASE_URL` the log is a
 * port that reports it recorded nothing, which is what a developer's machine
 * gets — not a silent no-op, because a deployment with no delivery log must not
 * look like one that has it.
 */
startTelemetry('kithena-messaging');

const PORT = Number(process.env['PORT'] ?? 4101);

const routes = compose({
  resendApiKey: process.env['RESEND_API_KEY'],
  from: process.env['RESEND_FROM'],
  replyTo: process.env['RESEND_REPLY_TO'],
  internalToken: process.env['INTERNAL_API_TOKEN'] ?? '',
  authOrigin: process.env['AUTH_ORIGIN'] ?? 'http://localhost:3100',
  allowLogTransport: process.env['NODE_ENV'] !== 'production',
  // Optional. Absent, nothing is recorded and the outcome lives in the response
  // and the structured log — a supported deployment, and the one `just
  // auth-dev` runs.
  databaseUrl: process.env['MESSAGING_DATABASE_URL'],
  webhookSecret: process.env['RESEND_WEBHOOK_SECRET'],
});

const server = createServer((request, response) => {
  void routes(request, response)
    .then((handled) => {
      if (!handled) response.writeHead(404).end();
    })
    .catch((error: unknown) => {
      // The message never reaches the caller. It can quote a provider's
      // response, which quotes the address it refused.
      logger.error({ url: request.url, error }, 'unhandled request failure');
      if (!response.headersSent) response.writeHead(500).end();
    });
});

server.listen(PORT, () => {
  logger.info({ service: 'messaging', port: PORT }, 'messaging listening');
});

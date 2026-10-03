import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import { compose } from './composition.js';

/**
 * The assistant: one question in words, answered across every module a
 * company has (assistant PRD §6.1).
 *
 * Port 4104, beside Slack (4102) and audit (4103). A platform service, not a
 * module: nobody buys it, it is not in `ModuleKey`, and it reaches a module
 * only over that module's capability routes, never by importing it. It keeps
 * nothing at rest — no database, no conversation, no cache of results.
 *
 * Words are never logged: a question can name a person, and a plan's filters
 * can name a leave type.
 */
startTelemetry('kithena-assistant');

const PORT = Number(process.env['PORT'] ?? 4104);

const route = compose(process.env);

const server = createServer((request, response) => {
  route(request)
    .then(({ status, body }) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    })
    .catch((error: unknown) => {
      logger.error({ err: error, url: request.url }, 'assistant request failed');
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"message":"Something went wrong"}');
    });
});

// SIGTERM drains it, then the process exits: a question in flight is answered.
onShutdown('http server', () => drain(server));

server.listen(PORT, () => {
  logger.info({ service: 'assistant', port: PORT }, 'assistant listening');
});

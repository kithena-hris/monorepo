import { createServer, type IncomingMessage } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import { compose } from './composition.js';
import { yogaOptions } from './graphql/schema.js';

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

// The web's questions, through the router (AST-035): the subgraph at `/graphql`.
const yoga = createYoga(yogaOptions);

/** A question is a few hundred bytes; anything past this is not one. */
const MAX_BODY = 16 * 1024;

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return '';
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer((request, response) => {
  if (new URL(request.url ?? '/', 'http://assistant.internal').pathname === '/graphql') {
    void yoga(request, response);
    return;
  }
  bodyOf(request)
    .then((body) =>
      route({ method: request.method, url: request.url, headers: request.headers, body }),
    )
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

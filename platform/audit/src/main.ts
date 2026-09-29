import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import { compose, configFrom } from './composition.js';
import { yogaOptions } from './graphql/schema.js';

/**
 * The audit service: the central activity log (`docs/audit.md`).
 *
 * Port 4103. Modules take 40xx and platform services 41xx: identity 4100,
 * messaging 4101, Slack 4102.
 *
 * A long-running process rather than a function, because it holds a Kafka
 * consumer open — the reason Slack runs beside People on the VM too.
 */
startTelemetry('kithena-audit');

const PORT = Number(process.env['PORT'] ?? 4103);

const composed = compose(configFrom(process.env));
composed.catch((error: unknown) => {
  // A log that failed to connect is a process to restart, not one quietly serving nothing.
  logger.error({ err: error }, 'audit failed to start');
  process.exit(1);
});

const yoga = createYoga(yogaOptions);

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  void yoga(request, response);
});

onShutdown('http server', () => drain(server));
onShutdown('audit', async () => (await composed).stop());

server.listen(PORT, () => {
  logger.info({ service: 'audit', port: PORT }, 'audit listening');
});

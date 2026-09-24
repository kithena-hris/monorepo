import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';
import { yogaOptions } from './graphql/schema.js';
import manifest from '../module.manifest.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';
import { wirePeople } from './http/server.js';
import { wireBackground } from './infrastructure/background.js';

startTelemetry(`kithena-${manifest.key}`);
wireConsumers();
wireBackground();

const yoga = createYoga(yogaOptions);

// Yoga's handler is async; a Node request listener is not. `void` says the
// rejection is handled inside Yoga, which it is, rather than hiding it.
const server = createServer((request, response) => {
  void yoga(request, response);
});
wirePeople(server);
// SIGTERM drains it; `wirePeople` closes what its requests use after (PEO-118).
onShutdown('http server', () => drain(server));
// 4001 by convention (modules on 40xx); `PEOPLE_PORT` for a second copy, as an acceptance run starts.
const port = Number(process.env['PEOPLE_PORT'] ?? 4001);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});

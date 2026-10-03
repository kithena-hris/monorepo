import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';
import { schema } from './graphql/schema.js';
import manifest from '../module.manifest.js';
import { timeoffListener } from './http/server.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';
import { wireBackground } from './infrastructure/background.js';

startTelemetry(`kithena-${manifest.key}`);
wireConsumers();
wireBackground();

const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });

// Yoga's handler is async; a Node request listener is not. `void` says the
// rejection is handled inside Yoga, which it is, rather than hiding it.
const server = createServer(
  timeoffListener((request, response) => {
    void yoga(request, response);
  }),
);

// SIGTERM drains it, then the process exits (PEO-118).
onShutdown('http server', () => drain(server));
// 4002 by convention (modules on 40xx); `TIMEOFF_PORT` for a second copy, as an acceptance run starts.
const port = Number(process.env['TIMEOFF_PORT'] ?? 4002);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});

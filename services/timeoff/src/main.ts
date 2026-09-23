import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';
import { schema } from './graphql/schema.js';
import manifest from '../module.manifest.js';

startTelemetry(`kithena-${manifest.key}`);

const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });

// Yoga's handler is async; a Node request listener is not. `void` says the
// rejection is handled inside Yoga, which it is, rather than hiding it.
const server = createServer((request, response) => {
  void yoga(request, response);
});

// SIGTERM drains it, then the process exits (PEO-118).
onShutdown('http server', () => drain(server));

server.listen(4002, () => {
  logger.info({ module: manifest.key, port: 4002 }, 'subgraph listening');
});

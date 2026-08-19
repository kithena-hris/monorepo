import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { startTelemetry, logger } from '@hris/telemetry';
import { schema } from './graphql/schema.js';
import manifest from '../module.manifest.js';

startTelemetry(`hris-${manifest.key}`);

const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });

// Yoga's handler is async; a Node request listener is not. `void` says the
// rejection is handled inside Yoga, which it is, rather than hiding it.
const server = createServer((request, response) => {
  void yoga(request, response);
});

server.listen(4002, () => {
  logger.info({ module: manifest.key, port: 4002 }, 'subgraph listening');
});

import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { startTelemetry, logger } from '@kithena/telemetry';
import { schema } from './graphql/schema.js';
import manifest from '../module.manifest.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';
import { wirePeople } from './http/server.js';
import { wireBackground } from './infrastructure/background.js';

startTelemetry(`kithena-${manifest.key}`);
wireConsumers();
wireBackground();

const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });

// Yoga's handler is async; a Node request listener is not. `void` says the
// rejection is handled inside Yoga, which it is, rather than hiding it.
const server = createServer((request, response) => {
  void yoga(request, response);
});
wirePeople(server);
server.listen(4001, () => {
  logger.info({ module: manifest.key, port: 4001 }, 'subgraph listening');
});

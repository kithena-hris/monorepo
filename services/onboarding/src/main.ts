import { createServer } from 'node:http';
import { inReaderLanguage } from '@kithena/auth-kit';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import manifest from '../module.manifest.js';
import { composeOnboarding } from './composition.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';

startTelemetry(`kithena-${manifest.key}`);
const { listener, storage } = composeOnboarding(process.env);
wireConsumers(process.env, storage?.deps ?? null);

// Each request in its reader's language: the words the module writes for them.
const server = createServer((request, response) => {
  inReaderLanguage(request.headers, () => {
    listener(request, response);
  });
});
onShutdown('http server', () => drain(server));
// 4006 by convention (modules on 40xx); `ONBOARDING_PORT` for a second copy.
const port = Number(process.env['ONBOARDING_PORT'] ?? 4006);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});

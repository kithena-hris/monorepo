import { createServer } from 'node:http';
import { inReaderLanguage } from '@kithena/auth-kit';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import manifest from '../module.manifest.js';
import { startSweep } from './application/launch.js';
import { deliverWebhooks } from './application/webhooks.js';
import { composePerformance } from './composition.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';

startTelemetry(`kithena-${manifest.key}`);
const { listener, storage } = composePerformance(process.env);
wireConsumers(process.env, storage?.deps ?? null);
if (storage !== null) {
  const stop = startSweep(storage.deps);
  // Webhooks every 30 seconds, one pass at a time.
  let delivering = false;
  const webhooks = setInterval(() => {
    if (delivering) return;
    delivering = true;
    deliverWebhooks(storage.deps)
      .catch((error: unknown) => {
        logger.warn({ module: manifest.key, err: String(error) }, 'webhook pass failed');
      })
      .finally(() => {
        delivering = false;
      });
  }, 30_000);
  webhooks.unref();
  onShutdown('performance sweep', () => {
    stop();
    clearInterval(webhooks);
    return Promise.resolve();
  });
}

// Each request in its reader's language: the words the module writes for them.
const server = createServer((request, response) => {
  inReaderLanguage(request.headers, () => {
    listener(request, response);
  });
});
onShutdown('http server', () => drain(server));
// 4007 by convention (modules on 40xx); `PERFORMANCE_PORT` for a second copy.
const port = Number(process.env['PERFORMANCE_PORT'] ?? 4007);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});

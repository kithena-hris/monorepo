import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import manifest from '../module.manifest.js';
import { startSweep } from './application/launch.js';
import { composePerformance } from './composition.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';

startTelemetry(`kithena-${manifest.key}`);
const { listener, storage } = composePerformance(process.env);
wireConsumers(process.env, storage?.deps ?? null);
if (storage !== null) {
  const stop = startSweep(storage.deps);
  onShutdown('performance sweep', () => {
    stop();
    return Promise.resolve();
  });
}

const server = createServer(listener);
onShutdown('http server', () => drain(server));
// 4007 by convention (modules on 40xx); `PERFORMANCE_PORT` for a second copy.
const port = Number(process.env['PERFORMANCE_PORT'] ?? 4007);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});
